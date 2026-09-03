/**
 * Accuracy check for the order-book reconstruction: for every runner snapshot
 * (exact chain reads in `book_snapshots`) whose market has synced order history,
 * reconstruct the book at the same second and compare best bid / best ask.
 *
 *   npx tsx services/data/src/compare-book.ts
 */
import { openDb } from "./db";
import { reconstructBook } from "./bookstate";

const db = openDb();
const snaps = db
  .prepare(
    `SELECT s.marketId, s.ts, s.yesBidRaw, s.yesAskRaw FROM book_snapshots s
     JOIN markets m ON m.marketId = s.marketId
     WHERE m.detailSynced = 1 AND EXISTS (SELECT 1 FROM orders o WHERE o.marketId = s.marketId)
     ORDER BY s.marketId, s.ts`,
  )
  .all() as { marketId: string; ts: number; yesBidRaw: string | null; yesAskRaw: string | null }[];

if (snaps.length === 0) {
  console.log("no snapshots with synced order history yet — run the runner, wait for those windows to finalize, then sync again");
  process.exit(0);
}
let bidExact = 0, askExact = 0, bidWithin1 = 0, askWithin1 = 0, n = 0;
const tick = 1000n;
for (const s of snaps) {
  const r = reconstructBook(db, s.marketId, s.ts, 1);
  const rb = r.yesBids[0]?.priceRaw ?? null, ra = r.yesAsks[0]?.priceRaw ?? null;
  const sb = s.yesBidRaw ? BigInt(s.yesBidRaw) : null, sa = s.yesAskRaw ? BigInt(s.yesAskRaw) : null;
  n++;
  const d = (a: bigint | null, b: bigint | null) => (a === null || b === null ? (a === b ? 0n : null) : a > b ? a - b : b - a);
  const db_ = d(rb, sb), da = d(ra, sa);
  if (db_ === 0n) bidExact++;
  if (da === 0n) askExact++;
  if (db_ !== null && db_ <= tick) bidWithin1++;
  if (da !== null && da <= tick) askWithin1++;
  if (n <= 15) console.log(`${s.marketId.slice(-6)} ${s.ts} snapshot bid/ask=${sb}/${sa} reconstructed=${rb}/${ra} resting=${r.resting}`);
}
console.log(`\n${n} snapshots compared: best bid exact ${bidExact} (${((100 * bidExact) / n).toFixed(0)}%), within 1 tick ${bidWithin1}; best ask exact ${askExact} (${((100 * askExact) / n).toFixed(0)}%), within 1 tick ${askWithin1}`);
