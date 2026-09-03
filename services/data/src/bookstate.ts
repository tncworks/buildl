/**
 * Approximate order-book reconstruction from the indexer's Order rows.
 *
 * An order is treated as resting at time `ts` when it was placed at or before `ts`,
 * had not expired, and either is still Open or was last updated (filled/cancelled/
 * expired) after `ts`. Partial fills are the known inaccuracy: `lastUpdatedAtTimestamp`
 * moves on every fill, so an order that was partially filled before `ts` and finished
 * after `ts` is counted at its FULL remaining size. This is why the book model is
 * labelled approximate and compared against runner snapshots (compare-book.ts).
 */
import type { Db } from "./db";

export interface BookLevelRaw {
  priceRaw: bigint;
  qtyRaw: bigint;
}

export interface ReconstructedBook {
  ts: number;
  yesBids: BookLevelRaw[];
  yesAsks: BookLevelRaw[];
  /** Number of order rows considered resting at ts. */
  resting: number;
}

interface OrderRow {
  isBid: number;
  side: string | null;
  priceRaw: string;
  fullQtyRaw: string;
  filledQtyRaw: string;
  remainingQtyRaw: string;
  status: string;
  placedAt: number;
  updatedAt: number;
  expireNs: string;
}

export function reconstructBook(db: Db, marketId: string, ts: number, depth = 5): ReconstructedBook {
  const rows = db
    .prepare(
      `SELECT isBid, side, priceRaw, fullQtyRaw, filledQtyRaw, remainingQtyRaw, status, placedAt, updatedAt, expireNs
       FROM orders WHERE marketId = ? AND placedAt <= ? AND (status = 'Open' OR updatedAt > ?)`,
    )
    .all(marketId.toLowerCase(), ts, ts) as unknown as OrderRow[];
  const tsNs = BigInt(ts) * 1_000_000_000n;
  const bids = new Map<bigint, bigint>();
  const asks = new Map<bigint, bigint>();
  let resting = 0;
  for (const o of rows) {
    if (BigInt(o.expireNs) <= tsNs) continue;
    // Size resting at ts: if the order was still Open at ts we cannot know how much had filled by then;
    // use full quantity when the order's terminal update is after ts, remaining otherwise.
    const qty = o.status === "Open" ? BigInt(o.remainingQtyRaw) : BigInt(o.fullQtyRaw);
    if (qty <= 0n) continue;
    resting++;
    const m = o.isBid ? bids : asks;
    const p = BigInt(o.priceRaw);
    m.set(p, (m.get(p) ?? 0n) + qty);
  }
  const yesBids = [...bids.entries()].sort((a, b) => (a[0] > b[0] ? -1 : 1)).slice(0, depth).map(([priceRaw, qtyRaw]) => ({ priceRaw, qtyRaw }));
  const yesAsks = [...asks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, depth).map(([priceRaw, qtyRaw]) => ({ priceRaw, qtyRaw }));
  return { ts, yesBids, yesAsks, resting };
}
