/**
 * Independent recomputation of the first N trades of a run, straight from raw
 * DB rows with plain SQL, without going through the engine's helpers. Prints
 * engine vs. recomputed values side by side and a MATCH/MISMATCH verdict.
 *
 *   npx tsx services/backtest/src/handcheck.ts --asset BTC --interval 300 --template momentum --n 10
 */
import { parseArgs } from "node:util";
import { openDb, networkFromEnv, endpoints } from "@calibrate/data";
import { runBacktest } from "./engine";
import type { TemplateId } from "./types";

const { values: a } = parseArgs({
  options: {
    asset: { type: "string", default: "BTC" },
    interval: { type: "string", default: "300" },
    template: { type: "string", default: "momentum" },
    params: { type: "string", default: "{}" },
    n: { type: "string", default: "10" },
  },
});
const network = networkFromEnv();
const venueId = (process.env.VENUE_ID ?? endpoints(network).defaultVenueId).toLowerCase();
const db = openDb();
const template = a.template as TemplateId;
const out = runBacktest(db, { network, venueId, asset: a.asset!.toUpperCase(), intervalSec: Number(a.interval), template, params: JSON.parse(a.params!) });
const params = { ...Object.fromEntries(out.spec.params.map((p) => [p.key, p.default])), ...out.request.params };
const trades = out.results.filter((r) => !r.skipped).slice(0, Number(a.n));
if (trades.length === 0) {
  console.log("no trades to check");
  process.exit(0);
}
const tick = network === "testnet" ? 0.001 : 0.001;
let mismatches = 0;
console.log(`checking ${trades.length} trades of ${out.spec.name} params=${JSON.stringify(params)}`);
for (const r of trades) {
  const m = db.prepare("SELECT expiry, tradingStart, winningOutcome, voided, openingAnswerRaw, strikeRaw, quoteDecimals, asset FROM markets WHERE marketId = ?").get(r.marketId) as {
    expiry: number; tradingStart: number; winningOutcome: number | null; voided: number; openingAnswerRaw: string | null; strikeRaw: string | null; quoteDecimals: number; asset: string;
  };
  const T = m.expiry - params.seconds_left!;
  const lastFill = db.prepare("SELECT ts, fillPriceRaw FROM fills WHERE marketId = ? AND ts <= ? ORDER BY ts DESC LIMIT 1").get(r.marketId, T) as { ts: number; fillPriceRaw: string } | undefined;
  const spot = db.prepare("SELECT ts, spotRaw FROM price_points WHERE symbol = ? AND ts <= ? ORDER BY ts DESC LIMIT 1").get(`${m.asset}/USDC`, T) as { ts: number; spotRaw: string } | undefined;
  const openRef = m.openingAnswerRaw && m.openingAnswerRaw !== "0" ? Number(m.openingAnswerRaw) / 100 : m.strikeRaw && m.strikeRaw !== "0" ? Number(m.strikeRaw) / 100 : null;
  const yesProb = lastFill ? Number(lastFill.fillPriceRaw) / 10 ** m.quoteDecimals : null;
  const spotNum = spot ? Number(spot.spotRaw) / 1e18 : null;
  const outcome = m.voided ? "VOID" : m.winningOutcome === 0 ? "UP" : m.winningOutcome === 1 ? "DOWN" : null;

  // Recompute the decision independently.
  let side: "UP" | "DOWN" | null = null;
  if (template === "momentum" && openRef !== null && spotNum !== null) {
    const bps = ((spotNum - openRef) / openRef) * 1e4;
    side = bps >= params.move_bps! ? "UP" : bps <= -params.move_bps! ? "DOWN" : null;
  } else if (template === "mispricing") {
    side = r.side; // walk-forward calibration is recomputed by the engine test; here we check the fill and payout arithmetic only
  }
  const sidePrint = yesProb === null || side === null ? null : side === "UP" ? yesProb : 1 - yesProb;
  const price = sidePrint === null ? null : Number((sidePrint + params.slippage_ticks! * tick).toFixed(6));
  const payout = outcome === "VOID" ? 0.5 : outcome === side ? 1 : 0;
  const pnl = price === null ? null : Number(((payout - price) * params.size!).toFixed(6));
  const age = lastFill ? T - lastFill.ts : null;

  const checks: [string, unknown, unknown][] = [
    ["decisionAt", r.decisionAt, T],
    ["side", r.side, side],
    ["printProb", r.printProb, yesProb],
    ["printAge", r.printAge, age],
    ["price", r.price, price],
    ["outcome", r.outcome, outcome],
    ["payout", r.payout, payout],
    ["pnl", r.pnl, pnl],
  ];
  const bad = checks.filter(([, e, h]) => JSON.stringify(e) !== JSON.stringify(h));
  if (bad.length) mismatches++;
  console.log(`${r.marketId.slice(-6)} expiry=${m.expiry} T=${T} spot=${spotNum} open=${openRef} yesPrint=${yesProb}@${lastFill?.ts} → ${bad.length ? "MISMATCH " + bad.map(([k, e, h]) => `${k}: engine=${e} hand=${h}`).join("; ") : "MATCH"} (side=${side} price=${price} outcome=${outcome} pnl=${pnl})`);
}
console.log(mismatches === 0 ? `ALL ${trades.length} MATCH` : `${mismatches} MISMATCH`);
process.exit(mismatches === 0 ? 0 : 1);
