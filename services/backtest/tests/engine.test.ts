import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA, computeFeatures } from "@calibrate/data";
import { runBacktest } from "../src/engine.js";
import { wilson95 } from "../src/metrics.js";
import { decideMomentum, decideMispricing, ladderRungs } from "../src/templates.js";
import type { DecisionContext } from "../src/types.js";

const VENUE = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";

function ctx(over: Partial<DecisionContext>): DecisionContext {
  return { t: 1000, tradingStart: 700, expiry: 1060, lastPrint: null, spot: null, openRef: null, calibration: () => null, params: {}, ...over };
}

describe("templates", () => {
  it("momentum buys UP when spot is above open by the threshold, DOWN below, nothing inside", () => {
    const base = { openRef: 100, params: { move_bps: 5, max_price: 0.9 } };
    expect(decideMomentum(ctx({ ...base, spot: { price: 100.06, ts: 999 } }))).toMatchObject({ side: "UP" });
    expect(decideMomentum(ctx({ ...base, spot: { price: 99.94, ts: 999 } }))).toMatchObject({ side: "DOWN" });
    expect(decideMomentum(ctx({ ...base, spot: { price: 100.02, ts: 999 } }))).toMatchObject({ skip: "no-signal" });
    expect(decideMomentum(ctx({ spot: { price: 1, ts: 1 }, params: {} }))).toMatchObject({ skip: "no-reference" });
  });
  it("mispricing uses the calibration lookup and respects min_bin_n", () => {
    const cal = () => ({ n: 10, upRate: 0.8, meanProb: 0.6 });
    expect(decideMispricing(ctx({ lastPrint: { prob: 0.6, ts: 999 }, calibration: cal, params: { edge: 0.1, min_bin_n: 5 } }))).toMatchObject({ side: "UP" });
    expect(decideMispricing(ctx({ lastPrint: { prob: 0.6, ts: 999 }, calibration: cal, params: { edge: 0.1, min_bin_n: 50 } }))).toMatchObject({ skip: "no-calibration" });
    expect(decideMispricing(ctx({ lastPrint: { prob: 0.95, ts: 999 }, calibration: cal, params: { edge: 0.1, min_bin_n: 5 } }))).toMatchObject({ side: "DOWN" });
  });
  it("ladder rungs are evenly spaced and inclusive", () => {
    expect(ladderRungs({ low_price: 0.2, high_price: 0.4, rungs: 3 })).toEqual([0.2, 0.3, 0.4]);
    expect(ladderRungs({ low_price: 0.2, high_price: 0.4, rungs: 1 })).toEqual([0.2]);
  });
});

describe("wilson95", () => {
  it("matches a known value (7/10 → 0.397..0.892)", () => {
    const [lo, hi] = wilson95(7, 10);
    expect(lo).toBeCloseTo(0.3968, 3);
    expect(hi).toBeCloseTo(0.8922, 3);
  });
});

describe("engine on a synthetic series", () => {
  // Three 300s windows. Prints and ticks are arranged so results can be checked by hand.
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const mk = db.prepare(`INSERT INTO markets (marketId, network, venueId, operatorId, asset, intervalSec, poolAddress, nonce, tradingStart, expiry, status,
    winningOutcome, voided, finalized, tradeCount, quoteVolumeRaw, baseVolumeRaw, quoteDecimals, baseDecimals, strikeRaw, openingAnswerRaw, closingAnswerRaw, resolvedAt, question, detailSynced, syncedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const fill = db.prepare("INSERT INTO fills (id, marketId, pool, ts, fillPriceRaw, quantityRaw, quoteQuantityRaw) VALUES (?,?,?,?,?,?,?)");
  const tick = db.prepare("INSERT INTO price_points (symbol, ts, spotRaw, markRaw) VALUES (?,?,?,?)");
  const raw18 = (x: number) => BigInt(Math.round(x * 1e6)).toString() + "000000000000"; // 18 dp from 6-dp precision

  // W1: open 100, spot at T-60 = 100.10 (+10bps) → UP; last print 0.60 at T-70 (age 10s); outcome UP → pnl = (1 - 0.602)*5
  mk.run("0x01", "testnet", VENUE, 2, "BTC", 300, "0xp", "1", 1000, 1300, "Finalized", 0, 0, 1, 1, "0", "0", 6, 6, "0", "10000", "10010", 1301, null, 1, 0);
  fill.run("f1", "0x01", "0xp", 1230, "600000", "1000000", "600000");
  tick.run("BTC/USDC", 1240, raw18(100.1), raw18(100.1));
  // W2: open 100, spot at T-60 = 99.90 (-10bps) → DOWN; last print 0.30 (YES) → DOWN price 0.70+0.002; outcome UP → pnl = (0 - 0.702)*5
  mk.run("0x02", "testnet", VENUE, 2, "BTC", 300, "0xp", "2", 1300, 1600, "Finalized", 0, 0, 1, 1, "0", "0", 6, 6, "0", "10000", "10005", 1601, null, 1, 0);
  fill.run("f2", "0x02", "0xp", 1535, "300000", "1000000", "300000");
  tick.run("BTC/USDC", 1540, raw18(99.9), raw18(99.9));
  // W3: no prints → skipped no-prints
  mk.run("0x03", "testnet", VENUE, 2, "BTC", 300, "0xp", "3", 1600, 1900, "Finalized", 1, 0, 1, 0, "0", "0", 6, 6, "0", "10000", "9990", 1901, null, 1, 0);
  tick.run("BTC/USDC", 1840, raw18(99.5), raw18(99.5));
  computeFeatures(db, { network: "testnet" });

  it("momentum: two trades with hand-computed pnl, one skip", () => {
    const out = runBacktest(db, { network: "testnet", venueId: VENUE, asset: "BTC", intervalSec: 300, template: "momentum", params: { move_bps: 5, seconds_left: 60, max_price: 0.9, size: 5, slippage_ticks: 2, stale_sec: 60 } });
    const [r1, r2, r3] = out.results;
    expect(r1).toMatchObject({ side: "UP", price: 0.602, payout: 1, pnl: Number(((1 - 0.602) * 5).toFixed(6)) });
    expect(r2).toMatchObject({ side: "DOWN", price: 0.702, payout: 0, pnl: Number(((0 - 0.702) * 5).toFixed(6)) });
    expect(r3).toMatchObject({ skipped: "no-prints" });
    expect(out.summary.trades).toBe(2);
    expect(out.summary.wins).toBe(1);
    expect(out.summary.totalPnl).toBeCloseTo((1 - 0.602) * 5 - 0.702 * 5, 6);
    expect(out.summary.maxDrawdown).toBeCloseTo(0.702 * 5, 6);
  });

  it("momentum: stale print is skipped, not filled", () => {
    const out = runBacktest(db, { network: "testnet", venueId: VENUE, asset: "BTC", intervalSec: 300, template: "momentum", params: { move_bps: 5, seconds_left: 60, stale_sec: 5 } });
    expect(out.results[0]).toMatchObject({ skipped: "no-fresh-print" });
  });

  it("mispricing is walk-forward: the first window has no calibration", () => {
    const out = runBacktest(db, { network: "testnet", venueId: VENUE, asset: "BTC", intervalSec: 300, template: "mispricing", params: { edge: 0.01, min_bin_n: 1, seconds_left: 60 } });
    expect(out.results[0]).toMatchObject({ skipped: "no-calibration" });
    // W2's print 0.30 falls in bin 6; W1's print 0.60 fell in bin 12 → still no calibration for W2's bucket.
    expect(out.results[1]).toMatchObject({ skipped: "no-calibration" });
  });

  it("ladder fills only rungs a later print reached", () => {
    const out = runBacktest(db, { network: "testnet", venueId: VENUE, asset: "BTC", intervalSec: 300, template: "ladder", params: { side_up: 1, low_price: 0.5, high_price: 0.7, rungs: 3, size_per_rung: 2, delay_sec: 0 } });
    // W1 print 0.60 → rungs 0.6 and 0.7 fill (print <= rung); 0.5 does not. cost = 0.6*2 + 0.7*2 = 2.6; payout 4 → pnl 1.4
    expect(out.results[0]).toMatchObject({ size: 4, pnl: 1.4 });
    // W2 print 0.30 → all three rungs fill; outcome UP → payout 6, cost (0.5+0.6+0.7)*2 = 3.6 → pnl 2.4
    expect(out.results[1]).toMatchObject({ size: 6, pnl: 2.4 });
  });
});
