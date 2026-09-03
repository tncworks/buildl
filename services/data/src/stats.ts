/** Print DB totals, per-series coverage, and the calibration table for one series. */
import { openDb } from "./db";
import { getCalibration, listSeries } from "./queries";
import { networkFromEnv } from "./client";

const db = openDb();
const network = networkFromEnv();
const totals = db
  .prepare("SELECT (SELECT COUNT(*) FROM markets) AS markets, (SELECT COUNT(*) FROM fills) AS fills, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM price_points) AS ticks, (SELECT COUNT(*) FROM window_features) AS features, (SELECT COUNT(*) FROM calibration) AS calibCells")
  .get();
console.log("totals", totals);
console.log("series:");
for (const s of listSeries(db, network)) {
  console.log(`  ${s.asset}/${s.intervalSec}s venue=${s.venueId.slice(0, 10)} windows=${s.windows} traded=${s.traded} trades=${s.trades} range=${new Date(s.firstExpiry * 1000).toISOString().slice(0, 16)}..${new Date(s.lastExpiry * 1000).toISOString().slice(0, 16)}`);
}
const asset = process.argv[2] ?? "BTC";
const intervalSec = Number(process.argv[3] ?? 300);
const venueId = (process.env.VENUE_ID ?? "").toLowerCase();
const key = { network, venueId, asset, intervalSec };
for (const t of [30, 60, 120]) {
  const bins = getCalibration(db, key, t);
  const n = bins.reduce((a, b) => a + b.n, 0);
  console.log(`calibration ${asset}/${intervalSec}s T-${t}s (n=${n}):`);
  for (const b of bins) console.log(`  [${b.binLow.toFixed(2)},${b.binHigh.toFixed(2)}) n=${String(b.n).padStart(4)} meanP=${b.meanProb.toFixed(3)} upRate=${(b.upWins / b.n).toFixed(3)} edge=${(b.upWins / b.n - b.meanProb).toFixed(3)}`);
}
