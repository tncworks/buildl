// Step 6b: one real IOC buy on a live 300s window through ec-core placeLimit, then
// wait for expiry and redeem through the SDK. Records every hash and receipt status.
//   node scripts/verify/write-path.mjs [--asset BTC] [--size 1] [--no-wait]
import { createExchange, activeMarkets, marketOnchain, placeLimit, outcomeSymbols, shutdown, assertTxOk } from "@calibrate/ec-core";
import { parseArgs } from "node:util";
process.env.DRY_RUN = "false";
const { values: a } = parseArgs({ options: { asset: { type: "string", default: "BTC" }, size: { type: "string", default: "1" }, "no-wait": { type: "boolean", default: false } } });

const ctx = createExchange({ withSigner: true });
const me = ctx.exchange.walletAddress;
console.log("address", me, "network", ctx.config.network, "venue", ctx.config.venueId, "tick", ctx.config.tick.toString(), "lot", ctx.config.lot.toString());

const markets = (await activeMarkets(ctx, { asset: a.asset, max: 20 })).filter((m) => Number(m.info.intervalSec) === 300);
const now = Math.floor(Date.now() / 1000);
const pick = markets.map((m) => ({ m, left: Number(m.info.expiry) - now })).filter((x) => x.left > 60).sort((x, y) => x.left - y.left)[0];
if (!pick) throw new Error("no live 300s market with >60s left; try again in a minute");
const { m } = pick;
const onchain = await marketOnchain(ctx, m);
if (!onchain || onchain.status !== 1) throw new Error(`market not Trading: ${onchain?.status}`);
console.log("market", m.symbol, "marketId", m.info.marketId, "expires in", pick.left, "s");

// Read the YES book from chain and cross the best ask with an IOC (cap 0.99).
const ob = await ctx.exchange.client.getBinaryOrderBook(onchain.pool, { depth: 3 });
const bestAsk = ob.yesAsks[0];
if (!bestAsk) throw new Error("no YES ask on the book right now; try again");
const askProb = Number(bestAsk.price) / 10 ** onchain.decimals;
const limit = Math.min(0.99, askProb + 0.002);
console.log("best YES ask", askProb, "→ IOC buy YES", a.size, "@", limit);
const res = await placeLimit(ctx, { market: m, onchain, outcome: "YES", side: "buy", price: limit, size: Number(a.size), type: "ioc", expiresInSec: 60 });
console.log("placeLimit", JSON.stringify(res, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
if (res.filled === 0) {
  console.log("IOC did not fill (book moved). Nothing to redeem.");
  await shutdown(ctx);
  process.exit(0);
}
const held = await ctx.exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: me, id: onchain.yesId });
console.log("YES balance after fill (raw)", held.toString());
if (a["no-wait"]) {
  console.log("--no-wait: skipping redeem. Market", m.info.marketId, "expires at", onchain.expiry.toString());
  await shutdown(ctx);
  process.exit(0);
}
console.log("waiting for resolution…");
let oc = onchain;
while (!oc.isResolved && !oc.isVoided) {
  await new Promise((r) => setTimeout(r, 15_000));
  oc = await ctx.exchange.client.getMarketOnchain(m.info.marketId);
  process.stdout.write(`status=${oc.status} `);
}
console.log("\nresolved: winningOutcome", oc.winningOutcome, "voided", oc.isVoided);
const winnerIsYes = oc.isVoided || oc.winningOutcome === 0;
const amount = await ctx.exchange.client.getOutcomeBalance({ outcomeToken: oc.outcomeToken, account: me, id: oc.yesId });
if (!winnerIsYes) {
  console.log("YES lost; redeeming a losing position pays 0 — calling redeem anyway to record behaviour");
}
const r = await ctx.exchange.trader.redeem({ marketId: m.info.marketId, outcomeIdx: 0, amount, market: oc.marketAddress, outcomeToken: oc.outcomeToken });
assertTxOk(r, "redeem");
console.log("redeem tx", r.hash, "status", r.receipt.status);
await shutdown(ctx);
process.exit(0);
