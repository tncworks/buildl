/**
 * Recompute the calibration table for one series with a single SQL statement
 * over the raw `markets` + `fills` tables (bypassing window_features and the
 * TypeScript in features.ts), then diff against the stored `calibration` rows.
 *
 *   npx tsx services/data/src/verify-calibration.ts BTC 300 60
 */
import { openDb } from "./db";
import { networkFromEnv, endpoints } from "./client";

const asset = (process.argv[2] ?? "BTC").toUpperCase();
const intervalSec = Number(process.argv[3] ?? 300);
const tSec = Number(process.argv[4] ?? 60);
const network = networkFromEnv();
const venueId = (process.env.VENUE_ID ?? endpoints(network).defaultVenueId).toLowerCase();
const db = openDb();

// Last fill at or before (expiry - tSec) per market, via a correlated subquery; bin = floor(prob * 20) clamped.
const raw = db
  .prepare(
    `WITH lastfill AS (
       SELECT m.marketId, m.winningOutcome, m.quoteDecimals,
              (SELECT f.fillPriceRaw FROM fills f WHERE f.marketId = m.marketId AND f.ts <= m.expiry - ? ORDER BY f.ts DESC LIMIT 1) AS priceRaw
       FROM markets m
       WHERE m.network = ? AND lower(m.venueId) = ? AND m.asset = ? AND m.intervalSec = ? AND m.voided = 0 AND m.winningOutcome IS NOT NULL
     ),
     probs AS (
       SELECT marketId, winningOutcome, CAST(priceRaw AS REAL) / power(10, quoteDecimals) AS prob FROM lastfill WHERE priceRaw IS NOT NULL
     )
     SELECT MIN(19, CAST(prob * 20 AS INTEGER)) AS bin, COUNT(*) AS n, SUM(CASE WHEN winningOutcome = 0 THEN 1 ELSE 0 END) AS upWins, SUM(prob) AS sumProb
     FROM probs GROUP BY bin ORDER BY bin`,
  )
  .all(tSec, network, venueId, asset, intervalSec) as { bin: number; n: number; upWins: number; sumProb: number }[];

const stored = db
  .prepare("SELECT bin, n, upWins, sumProb FROM calibration WHERE network = ? AND lower(venueId) = ? AND asset = ? AND intervalSec = ? AND tSec = ? ORDER BY bin")
  .all(network, venueId, asset, intervalSec, tSec) as { bin: number; n: number; upWins: number; sumProb: number }[];

let bad = 0;
const byBin = new Map(stored.map((s) => [s.bin, s]));
console.log(`series ${asset}/${intervalSec}s T-${tSec}s: raw-SQL bins=${raw.length} stored bins=${stored.length}`);
console.log("bin  n(sql) n(stored)  up(sql) up(stored)  sumProb(sql) sumProb(stored)");
for (const r of raw) {
  const s = byBin.get(r.bin);
  const ok = s && s.n === r.n && s.upWins === r.upWins && Math.abs(s.sumProb - r.sumProb) < 1e-6;
  if (!ok) bad++;
  console.log(`${String(r.bin).padStart(3)}  ${String(r.n).padStart(6)} ${String(s?.n ?? "-").padStart(9)}  ${String(r.upWins).padStart(7)} ${String(s?.upWins ?? "-").padStart(10)}  ${r.sumProb.toFixed(4).padStart(12)} ${(s?.sumProb ?? NaN).toFixed(4).padStart(15)}  ${ok ? "" : "MISMATCH"}`);
}
for (const s of stored) if (!raw.find((r) => r.bin === s.bin)) (bad++, console.log(`bin ${s.bin} stored but absent in raw SQL: MISMATCH`));
console.log(bad === 0 ? "ALL BINS MATCH" : `${bad} MISMATCH`);
process.exit(bad === 0 ? 0 : 1);
