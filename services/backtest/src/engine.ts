/**
 * Replays settled windows for one series. For each window the template sees
 * only data at or before its decision time; the fill is estimated from prints;
 * the payout comes from the recorded outcome.
 */
import { NETWORKS, feedRawToNumber, priceRawToProb, type Network } from "@calibrate/shared";
import { binOf, N_BINS, getFills, listWindows, reconstructBook, spotAt, type Db, type WindowRow } from "@calibrate/data";
import { summarize } from "./metrics";
import { TEMPLATES, decideMispricing, decideMomentum, isDecision, ladderRungs } from "./templates";
import type { Decision, DecisionContext, RunRequest, RunResult, Side, WindowResult } from "./types";

interface Print {
  ts: number;
  prob: number;
}

function outcomeOf(w: WindowRow): "UP" | "DOWN" | "VOID" | null {
  if (w.voided) return "VOID";
  if (w.winningOutcome === 0) return "UP";
  if (w.winningOutcome === 1) return "DOWN";
  return null;
}

function payoutFor(side: Side, outcome: "UP" | "DOWN" | "VOID"): number {
  if (outcome === "VOID") return 0.5;
  return outcome === side ? 1 : 0;
}

/** Walk-forward calibration accumulator keyed by (secondsLeft bucket, prob bin). */
class RollingCalibration {
  private cells = new Map<string, { n: number; up: number; sumProb: number }>();
  private key(secondsLeft: number, prob: number) {
    // Calibration is kept per template decision time, so secondsLeft is a single value per run.
    return `${secondsLeft}|${binOf(prob)}`;
  }
  lookup(secondsLeft: number, prob: number) {
    const c = this.cells.get(this.key(secondsLeft, prob));
    return c && c.n > 0 ? { n: c.n, upRate: c.up / c.n, meanProb: c.sumProb / c.n } : null;
  }
  add(secondsLeft: number, prob: number, wonUp: boolean) {
    const k = this.key(secondsLeft, prob);
    const c = this.cells.get(k) ?? { n: 0, up: 0, sumProb: 0 };
    c.n++;
    c.sumProb += prob;
    if (wonUp) c.up++;
    this.cells.set(k, c);
  }
}

export function runBacktest(db: Db, req: RunRequest): RunResult {
  const spec = TEMPLATES[req.template];
  const params = { ...Object.fromEntries(spec.params.map((p) => [p.key, p.default])), ...req.params };
  const net = NETWORKS[req.network as Network];
  const tick = Number(net.tickRaw) / 10 ** net.collateralDecimals;
  const symbol = `${req.asset.toUpperCase()}/${net.priceFeedQuote}`;
  const windows = listWindows(db, req, { from: req.from, to: req.to });
  const rolling = new RollingCalibration();
  const results: WindowResult[] = [];

  for (const w of windows) {
    const outcome = outcomeOf(w);
    const base: WindowResult = {
      marketId: w.marketId, expiry: w.expiry, tradingStart: w.tradingStart, decisionAt: null, side: null, reason: null,
      price: null, printProb: null, printAge: null, size: 0, outcome, payout: null, pnl: null, skipped: null,
    };
    if (!outcome) {
      results.push({ ...base, skipped: "no-outcome" });
      continue;
    }
    const prints: Print[] = getFills(db, w.marketId).map((f) => ({ ts: f.ts, prob: priceRawToProb(f.fillPriceRaw, w.quoteDecimals) }));

    if (req.template === "ladder") {
      results.push(runLadder(w, prints, params, outcome, base));
      continue;
    }

    // ---- taker templates
    const secondsLeft = params.seconds_left!;
    const t = w.expiry - secondsLeft;
    const lastPrint = [...prints].reverse().find((p) => p.ts <= t) ?? null;
    const spotRow = spotAt(db, symbol, t);
    const ctx: DecisionContext = {
      t, tradingStart: w.tradingStart, expiry: w.expiry,
      lastPrint,
      spot: spotRow ? { price: feedRawToNumber(spotRow.spotRaw), ts: spotRow.ts } : null,
      openRef: w.openRef ?? null,
      calibration: (sl, p) => rolling.lookup(sl, p),
      params,
    };
    // Add this window to the rolling calibration AFTER deciding (walk-forward, no leakage).
    const addToCalibration = () => {
      if (lastPrint && outcome !== "VOID") rolling.add(secondsLeft, lastPrint.prob, outcome === "UP");
    };

    if (prints.length === 0) {
      results.push({ ...base, decisionAt: t, skipped: "no-prints" });
      continue;
    }
    const d = req.template === "momentum" ? decideMomentum(ctx) : decideMispricing(ctx);
    if (!isDecision(d)) {
      results.push({ ...base, decisionAt: t, skipped: d.skip });
      addToCalibration();
      continue;
    }
    if (!lastPrint) {
      results.push({ ...base, decisionAt: t, side: d.side, reason: d.reason, skipped: "no-prints" });
      continue;
    }
    const age = t - lastPrint.ts;
    if (age > params.stale_sec!) {
      results.push({ ...base, decisionAt: t, side: d.side, reason: d.reason, printProb: lastPrint.prob, printAge: age, skipped: "no-fresh-print" });
      addToCalibration();
      continue;
    }
    let sidePrint = d.side === "UP" ? lastPrint.prob : 1 - lastPrint.prob;
    if (req.fillModel === "book") {
      // Buying UP crosses the YES ask; buying DOWN crosses the YES bid (a SELL_NO / BUY_YES resting order) at 1 - bid.
      const book = reconstructBook(db, w.marketId, t, 1);
      const one = 10 ** w.quoteDecimals;
      const quote = d.side === "UP" ? book.yesAsks[0] : book.yesBids[0];
      if (!quote) {
        results.push({ ...base, decisionAt: t, side: d.side, reason: d.reason, printProb: lastPrint.prob, printAge: age, skipped: "no-book" });
        addToCalibration();
        continue;
      }
      const yesPx = Number(quote.priceRaw) / one;
      sidePrint = d.side === "UP" ? yesPx : 1 - yesPx;
    }
    const price = Number((sidePrint + params.slippage_ticks! * tick).toFixed(6));
    if (price > d.limitPrice || price >= 1) {
      results.push({ ...base, decisionAt: t, side: d.side, reason: d.reason, printProb: lastPrint.prob, printAge: age, price, skipped: "price-cap" });
      addToCalibration();
      continue;
    }
    const size = Math.max(0, Math.floor(params.size!));
    if (size === 0) {
      results.push({ ...base, decisionAt: t, side: d.side, reason: d.reason, skipped: "size-zero" });
      addToCalibration();
      continue;
    }
    const payout = payoutFor(d.side, outcome);
    results.push({
      ...base, decisionAt: t, side: d.side, reason: d.reason, printProb: lastPrint.prob, printAge: age, price, size, payout,
      pnl: Number(((payout - price) * size).toFixed(6)),
    });
    addToCalibration();
  }

  return { request: req, spec, summary: summarize(results), results };
}

function runLadder(w: WindowRow, prints: Print[], params: Record<string, number>, outcome: "UP" | "DOWN" | "VOID", base: WindowResult): WindowResult {
  const side: Side = (params.side_up ?? 1) >= 1 ? "UP" : "DOWN";
  const placedAt = w.tradingStart + (params.delay_sec ?? 0);
  if (placedAt >= w.expiry) return { ...base, decisionAt: placedAt, side, skipped: "no-signal" };
  if (prints.length === 0) return { ...base, decisionAt: placedAt, side, skipped: "no-prints" };
  const rungs = ladderRungs(params);
  const later = prints.filter((p) => p.ts >= placedAt);
  let filledContracts = 0;
  let cost = 0;
  const filledRungs: number[] = [];
  for (const r of rungs) {
    // A bid at r for `side` fills if any later print traded at or below r on that side.
    const hit = later.some((p) => (side === "UP" ? p.prob : 1 - p.prob) <= r);
    if (hit) {
      filledRungs.push(r);
      filledContracts += params.size_per_rung ?? 1;
      cost += r * (params.size_per_rung ?? 1);
    }
  }
  if (filledContracts === 0) return { ...base, decisionAt: placedAt, side, reason: `no print reached ${rungs.map((r) => r.toFixed(2)).join("/")}`, skipped: "no-signal" };
  const payout = payoutFor(side, outcome);
  const avg = cost / filledContracts;
  return {
    ...base, decisionAt: placedAt, side, reason: `filled rungs ${filledRungs.map((r) => r.toFixed(2)).join(", ")}`,
    price: Number(avg.toFixed(6)), size: filledContracts, payout, pnl: Number((payout * filledContracts - cost).toFixed(6)),
  };
}

export { N_BINS };
export type { Decision };
