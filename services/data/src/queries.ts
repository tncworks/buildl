/** Read API over the SQLite DB, used by services/backtest and apps/web. */
import type { CalibrationBin, FillRecord, MarketRecord, SeriesKey } from "@calibrate/shared";
import { N_BINS } from "./features";
import type { Db } from "./db";

export interface SeriesSummary extends SeriesKey {
  windows: number;
  traded: number;
  trades: number;
  firstExpiry: number;
  lastExpiry: number;
}

export function listSeries(db: Db, network?: string): SeriesSummary[] {
  return db
    .prepare(
      `SELECT network, venueId, asset, intervalSec, COUNT(*) AS windows,
              SUM(CASE WHEN tradeCount > 0 THEN 1 ELSE 0 END) AS traded, SUM(tradeCount) AS trades,
              MIN(expiry) AS firstExpiry, MAX(expiry) AS lastExpiry
       FROM markets ${network ? "WHERE network = ?" : ""}
       GROUP BY network, venueId, asset, intervalSec ORDER BY windows DESC`,
    )
    .all(...(network ? [network] : [])) as unknown as SeriesSummary[];
}

export function getCalibration(db: Db, key: SeriesKey, tSec: number): CalibrationBin[] {
  const rows = db
    .prepare(
      `SELECT bin, n, upWins, sumProb FROM calibration
       WHERE network = ? AND lower(venueId) = lower(?) AND asset = ? AND intervalSec = ? AND tSec = ? ORDER BY bin`,
    )
    .all(key.network, key.venueId, key.asset, key.intervalSec, tSec) as unknown as { bin: number; n: number; upWins: number; sumProb: number }[];
  return rows.map((r) => ({ tSec, bin: r.bin, binLow: r.bin / N_BINS, binHigh: (r.bin + 1) / N_BINS, n: r.n, upWins: r.upWins, meanProb: r.sumProb / r.n }));
}

export interface WindowRow extends MarketRecord {
  nTrades: number | null;
  lastTradeProbAtT30: number | null;
  lastTradeProbAtT60: number | null;
  lastTradeProbAtT120: number | null;
  openRef: number | null;
  closeRef: number | null;
}

export function listWindows(db: Db, key: SeriesKey, opts: { from?: number; to?: number; tradedOnly?: boolean } = {}): WindowRow[] {
  const clauses = ["m.network = ?", "lower(m.venueId) = lower(?)", "m.asset = ?", "m.intervalSec = ?"];
  const params: (string | number)[] = [key.network, key.venueId, key.asset, key.intervalSec];
  if (opts.from !== undefined) (clauses.push("m.expiry >= ?"), params.push(opts.from));
  if (opts.to !== undefined) (clauses.push("m.expiry <= ?"), params.push(opts.to));
  if (opts.tradedOnly) clauses.push("m.tradeCount > 0");
  return db
    .prepare(
      `SELECT m.*, f.nTrades, f.lastTradeProbAtT30, f.lastTradeProbAtT60, f.lastTradeProbAtT120, f.openRef, f.closeRef
       FROM markets m LEFT JOIN window_features f ON f.marketId = m.marketId
       WHERE ${clauses.join(" AND ")} ORDER BY m.expiry ASC`,
    )
    .all(...params) as unknown as WindowRow[];
}

export function getFills(db: Db, marketId: string): FillRecord[] {
  return db.prepare("SELECT * FROM fills WHERE marketId = ? ORDER BY ts ASC").all(marketId.toLowerCase()) as unknown as FillRecord[];
}

export function getMarket(db: Db, marketId: string): MarketRecord | undefined {
  return db.prepare("SELECT * FROM markets WHERE marketId = ?").get(marketId.toLowerCase()) as unknown as MarketRecord | undefined;
}

/** Last spot tick at or before `ts` for a feed symbol. */
export function spotAt(db: Db, symbol: string, ts: number): { ts: number; spotRaw: string } | undefined {
  return db.prepare("SELECT ts, spotRaw FROM price_points WHERE symbol = ? AND ts <= ? ORDER BY ts DESC LIMIT 1").get(symbol, ts) as
    | { ts: number; spotRaw: string }
    | undefined;
}

/** All ticks in [from, to] for a symbol, ascending. */
export function ticksBetween(db: Db, symbol: string, from: number, to: number): { ts: number; spotRaw: string }[] {
  return db.prepare("SELECT ts, spotRaw FROM price_points WHERE symbol = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC").all(symbol, from, to) as unknown as {
    ts: number;
    spotRaw: string;
  }[];
}
