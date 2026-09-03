/**
 * Live strategy runner: one process, one key, one series, one template.
 *
 *   STRATEGY_JSON='{"asset":"BTC","intervalSec":300,"template":"momentum","params":{...}}' \
 *   PRIVATE_KEY=0x… DRY_RUN=false npx tsx services/runner/src/runner.ts
 *
 * Every tick it:
 *   1. lists live markets on the venue (ec-core activeMarkets → SDK loadMarkets) and
 *      gates each on the ON-CHAIN status (getMarketOnchain.status === 1),
 *   2. snapshots the chain order book into book_snapshots (exact history for later backtests),
 *   3. builds the same DecisionContext the backtester uses and calls the same template function,
 *   4. places an IOC (taker templates) or post-only rungs (ladder) through ec-core placeLimit,
 *      which snaps to tick/lot, caps expiry at market expiry and asserts the receipt,
 *   5. tracks its own trades to settlement and claims winnings in the same loop (single key,
 *      serialized writes).
 * Emits one JSON object per line on stdout. Refuses to run on mainnet.
 */
import { NETWORKS, feedSymbol, type Network } from "@calibrate/shared";
import { getCalibration, openDb, readOnlyExchange } from "@calibrate/data";
import { TEMPLATES, decideMispricing, decideMomentum, isDecision, ladderRungs } from "@calibrate/backtest/templates";
import type { DecisionContext, TemplateId } from "@calibrate/backtest/types";
import { activeMarkets, cancelTracked, createExchange, marketOnchain, maybeClaim, placeLimit, shutdown, type EcContext } from "@calibrate/ec-core";
import type { BinaryMarket, MarketOnchain } from "@somnia-chain/markets-sdk";

interface Spec {
  asset: string;
  intervalSec: number;
  template: TemplateId;
  params: Record<string, number>;
  tickMs?: number;
  claimIntervalMs?: number;
}

type Event = Record<string, unknown> & { type: string };
const emit = (e: Event) => process.stdout.write(JSON.stringify({ t: Date.now(), ...e }) + "\n");
const nowSec = () => Math.floor(Date.now() / 1000);

const spec = JSON.parse(process.env.STRATEGY_JSON ?? "{}") as Spec;
if (!spec.asset || !spec.intervalSec || !TEMPLATES[spec.template]) {
  emit({ type: "error", message: "STRATEGY_JSON must have asset, intervalSec, template" });
  process.exit(2);
}
const params = { ...Object.fromEntries(TEMPLATES[spec.template].params.map((p) => [p.key, p.default])), ...spec.params };
const network = ((process.env.NETWORK ?? "testnet").toLowerCase() === "mainnet" ? "mainnet" : "testnet") as Network;
if (network !== "testnet") {
  emit({ type: "error", message: "runner refuses to run on mainnet" });
  process.exit(2);
}
const dryRun = (process.env.DRY_RUN ?? "true") !== "false";
const tickMs = spec.tickMs ?? 3000;
const net = NETWORKS[network];
const tick = Number(net.tickRaw) / 10 ** net.collateralDecimals;
const venueId = (process.env.VENUE_ID ?? net.defaultVenueId).toLowerCase();

interface Position { marketId: string; side: "UP" | "DOWN"; price: number; size: number; filled: number; expiry: number; settled?: boolean; pnl?: number; hash?: string }
const positions = new Map<string, Position>();
const decided = new Set<string>(); // marketIds already acted on (one decision per window)
const laddered = new Set<string>();
const openRefCache = new Map<string, number | null>();
let stopping = false;

async function main() {
  // Tick/lot from chain, never from defaults: read the first live pool's params before ec-core loads its config.
  const ro = readOnlyExchange(network);
  const live = await ro.client.listLiveBinaryMarkets({ venueId, asset: spec.asset, intervalSec: spec.intervalSec, limit: 1 });
  if (live[0]) {
    const bp = await ro.client.getBinaryBookParams(live[0].poolAddress);
    process.env.MM_TICK = bp.tickSize.toString();
    process.env.MM_LOT = bp.lotSize.toString();
    emit({ type: "bookParams", pool: live[0].poolAddress, tickSize: bp.tickSize.toString(), lotSize: bp.lotSize.toString(), minQuantity: bp.minQuantity.toString() });
  }
  process.env.VENUE_ID = venueId;
  process.env.DRY_RUN = dryRun ? "true" : "false";
  const ctx: EcContext = createExchange({ withSigner: !dryRun });
  const db = openDb();
  const snapIns = db.prepare("INSERT OR IGNORE INTO book_snapshots (marketId, ts, yesBidRaw, yesBidQtyRaw, yesAskRaw, yesAskQtyRaw, depthJson) VALUES (?,?,?,?,?,?,?)");
  const address = ctx.exchange.walletAddress ?? null;
  emit({ type: "start", network, venueId, address, dryRun, spec: { ...spec, params }, tickMs });

  const onStop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    emit({ type: "stopping", signal });
    try {
      if (!dryRun) {
        const c = await cancelTracked(ctx);
        emit({ type: "cancelled", ...c });
      }
    } catch (e) {
      emit({ type: "error", where: "cancelTracked", message: (e as Error).message });
    }
    await shutdown(ctx).catch(() => {});
    emit({ type: "stop" });
    process.exit(0);
  };
  process.on("SIGTERM", () => void onStop("SIGTERM"));
  process.on("SIGINT", () => void onStop("SIGINT"));

  const calibrationLookup = (secondsLeft: number, prob: number) => {
    const tSec = [30, 60, 120].reduce((a, b) => (Math.abs(b - secondsLeft) < Math.abs(a - secondsLeft) ? b : a));
    const bins = getCalibration(db, { network, venueId, asset: spec.asset, intervalSec: spec.intervalSec }, tSec);
    const bin = Math.max(0, Math.min(19, Math.floor(prob * 20)));
    const b = bins.find((x) => x.bin === bin);
    return b ? { n: b.n, upRate: b.upWins / b.n, meanProb: b.meanProb } : null;
  };

  for (;;) {
    if (stopping) return;
    const t0 = Date.now();
    try {
      await tickOnce(ctx, calibrationLookup, (row) => snapIns.run(...row));
      if (!dryRun) await maybeClaim(ctx, { intervalMs: spec.claimIntervalMs ?? 120_000, scan: 25 });
      await settlePositions(ctx);
    } catch (e) {
      emit({ type: "error", where: "tick", message: (e as Error).message?.split("\n")[0] });
    }
    const wait = Math.max(250, tickMs - (Date.now() - t0));
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function tickOnce(ctx: EcContext, calibration: DecisionContext["calibration"], snap: (row: (string | number | null)[]) => void) {
  const markets = (await activeMarkets(ctx, { asset: spec.asset, max: 20 })).filter((m) => Number((m.info as BinaryMarket).intervalSec) === spec.intervalSec);
  const now = nowSec();
  for (const m of markets) {
    const info = m.info as BinaryMarket;
    const marketId = info.marketId.toLowerCase();
    const onchain = await marketOnchain(ctx, m);
    if (!onchain) continue;
    const secondsLeft = Number(onchain.expiry) - now;
    // --- book snapshot (exact history for future backtests)
    try {
      const ob = await ctx.exchange.client.getBinaryOrderBook(onchain.pool, { depth: 5 });
      const bb = ob.yesBids[0], ba = ob.yesAsks[0];
      snap([marketId, now, bb ? String(bb.price) : null, bb ? String(bb.quantity) : null, ba ? String(ba.price) : null, ba ? String(ba.quantity) : null, JSON.stringify({ yesBids: ob.yesBids.slice(0, 5), yesAsks: ob.yesAsks.slice(0, 5) }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))]);
    } catch (e) {
      emit({ type: "warn", where: "snapshot", marketId, message: (e as Error).message?.split("\n")[0] });
    }
    if (onchain.status !== 1) continue; // gate on chain status, never the indexer
    if (spec.template === "ladder") {
      await maybeLadder(ctx, m, info, onchain, secondsLeft);
      continue;
    }
    // --- taker templates: act once, inside [5s, seconds_left] before expiry
    if (decided.has(marketId)) continue;
    if (secondsLeft > params.seconds_left! || secondsLeft < 5) continue;
    decided.add(marketId);
    // Prints for THIS market only: pools are recycled across windows, so filter by marketId and tradingStart.
    const fills = await ctx.exchange.client.getFills(onchain.pool, { since: Number(info.tradingStart), until: now, limit: 50 });
    const last = fills
      .filter((f) => f.market.toLowerCase() === marketId && Number(f.timestamp) >= Number(info.tradingStart))
      .map((f) => ({ prob: Number(f.fillPrice) / 10 ** onchain.decimals, ts: Number(f.timestamp) }))
      .filter((x) => x.ts <= now)
      .sort((a, b) => b.ts - a.ts)[0] ?? null;
    const price = await ctx.exchange.fetchPrice(spec.asset).catch(() => null);
    const spot = price ? { price: price.price, ts: Math.floor(price.timestamp / 1000) } : null;
    const openRef = await openingRef(ctx, info);
    const dctx: DecisionContext = { t: now, tradingStart: Number(info.tradingStart), expiry: Number(onchain.expiry), lastPrint: last, spot, openRef, calibration, params };
    const d = spec.template === "momentum" ? decideMomentum(dctx) : decideMispricing(dctx);
    if (!isDecision(d)) {
      emit({ type: "decision", marketId, secondsLeft, skipped: d.skip, lastPrint: last, spot, openRef });
      continue;
    }
    if (!last) {
      emit({ type: "decision", marketId, secondsLeft, side: d.side, skipped: "no-prints", reason: d.reason });
      continue;
    }
    const age = now - last.ts;
    if (age > params.stale_sec!) {
      emit({ type: "decision", marketId, secondsLeft, side: d.side, skipped: "no-fresh-print", printAge: age, reason: d.reason });
      continue;
    }
    const sidePrint = d.side === "UP" ? last.prob : 1 - last.prob;
    const limit = Number((sidePrint + params.slippage_ticks! * tick).toFixed(6));
    if (limit > d.limitPrice || limit >= 1) {
      emit({ type: "decision", marketId, secondsLeft, side: d.side, skipped: "price-cap", limit, reason: d.reason });
      continue;
    }
    emit({ type: "decision", marketId, secondsLeft, side: d.side, limit, size: params.size, printProb: last.prob, printAge: age, spot, openRef, reason: d.reason });
    if (dryRun) {
      emit({ type: "order", marketId, dryRun: true, side: d.side, limit, size: params.size });
      continue;
    }
    const res = await placeLimit(ctx, { market: m, onchain, outcome: d.side === "UP" ? "YES" : "NO", side: "buy", price: limit, size: params.size!, type: "ioc", expiresInSec: 60 });
    emit({ type: "order", marketId, side: d.side, limit: res.price, size: res.size, filled: res.filled, rested: res.rested, hash: res.hash ?? null });
    if (res.filled > 0) positions.set(marketId, { marketId, side: d.side, price: res.price, size: res.size, filled: res.filled, expiry: Number(onchain.expiry), hash: res.hash });
  }
}

async function maybeLadder(ctx: EcContext, m: Parameters<typeof placeLimit>[1]["market"], info: BinaryMarket, onchain: MarketOnchain, secondsLeft: number) {
  const marketId = info.marketId.toLowerCase();
  if (laddered.has(marketId)) return;
  const sinceOpen = nowSec() - Number(info.tradingStart);
  if (sinceOpen < (params.delay_sec ?? 0) || secondsLeft < 10) return;
  laddered.add(marketId);
  const side = (params.side_up ?? 1) >= 1 ? "UP" : "DOWN";
  const rungs = ladderRungs(params);
  emit({ type: "decision", marketId, secondsLeft, side, rungs, size: params.size_per_rung, reason: `ladder ${rungs.map((r) => r.toFixed(2)).join("/")}` });
  for (const r of rungs) {
    if (dryRun) {
      emit({ type: "order", marketId, dryRun: true, side, limit: r, size: params.size_per_rung, postOnly: true });
      continue;
    }
    try {
      const res = await placeLimit(ctx, { market: m, onchain, outcome: side === "UP" ? "YES" : "NO", side: "buy", price: r, size: params.size_per_rung!, type: "post-only", expiresInSec: 100_000 });
      emit({ type: "order", marketId, side, limit: res.price, size: res.size, filled: res.filled, rested: res.rested, orderId: res.orderId?.toString() ?? null, hash: res.hash ?? null });
      const p = positions.get(marketId) ?? { marketId, side, price: 0, size: 0, filled: 0, expiry: Number(onchain.expiry) };
      // Resting rungs are settled by balance at expiry (see settlePositions); record the intent.
      p.size += res.size;
      p.price = p.size ? (p.price * (p.size - res.size) + res.price * res.size) / p.size : res.price;
      positions.set(marketId, p);
    } catch (e) {
      emit({ type: "error", where: "ladder", marketId, rung: r, message: (e as Error).message?.split("\n")[0] });
    }
  }
}

async function openingRef(ctx: EcContext, info: BinaryMarket): Promise<number | null> {
  const id = info.marketId.toLowerCase();
  if (openRefCache.has(id)) return openRefCache.get(id)!;
  let ref: number | null = null;
  try {
    const map = await ctx.exchange.client.getOpeningPrices([id]);
    const v = map[id] ?? map[info.marketId];
    if (v && v !== "0") ref = Number(v) / 100;
  } catch {}
  if (ref === null && info.strike && info.strike !== "0") ref = Number(info.strike) / 100;
  openRefCache.set(id, ref);
  return ref;
}

/** After expiry, resolve each position from chain and report realized PnL. */
async function settlePositions(ctx: EcContext) {
  const now = nowSec();
  for (const p of positions.values()) {
    if (p.settled || now < p.expiry + 5) continue;
    const oc = await ctx.exchange.client.getMarketOnchain(p.marketId as `0x${string}`);
    if (!oc.isResolved && !oc.isVoided) continue;
    // Balance-based: for ladders, what actually filled is what we hold.
    const me = ctx.exchange.walletAddress;
    let held = p.filled;
    if (me && spec.template === "ladder") {
      const id = p.side === "UP" ? oc.yesId : oc.noId;
      const bal = await ctx.exchange.client.getOutcomeBalance({ outcomeToken: oc.outcomeToken, account: me, id });
      held = Number(bal) / 10 ** oc.decimals;
    }
    const payout = oc.isVoided ? 0.5 : (oc.winningOutcome === 0 ? "UP" : "DOWN") === p.side ? 1 : 0;
    p.settled = true;
    p.filled = held;
    p.pnl = Number(((payout - p.price) * held).toFixed(6));
    emit({ type: "settled", marketId: p.marketId, side: p.side, price: p.price, filled: held, outcome: oc.isVoided ? "VOID" : oc.winningOutcome === 0 ? "UP" : "DOWN", payout, pnl: p.pnl });
  }
}

main().catch((e) => {
  emit({ type: "error", where: "main", message: (e as Error).message });
  process.exit(1);
});
