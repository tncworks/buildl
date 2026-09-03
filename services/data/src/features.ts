import { moveBps, oracleRawToNumber, feedRawToNumber, priceRawToProb } from "@calibrate/shared";
import type { Db } from "./db.js";

export const T_SECS = [30, 60, 120] as const;
export const N_BINS = 20;

interface MarketLite {
  marketId: string;
  asset: string;
  tradingStart: number;
  expiry: number;
  quoteDecimals: number;
  baseDecimals: number;
  strikeRaw: string | null;
  openingAnswerRaw: string | null;
  closingAnswerRaw: string | null;
}

interface FillLite {
  ts: number;
  fillPriceRaw: string;
  quantityRaw: string;
}

/** Reference (opening) price for a window: opening answer first, non-zero strike as fallback. */
export function referencePrice(m: Pick<MarketLite, "openingAnswerRaw" | "strikeRaw">): number | null {
  if (m.openingAnswerRaw && m.openingAnswerRaw !== "0") return oracleRawToNumber(m.openingAnswerRaw);
  if (m.strikeRaw && m.strikeRaw !== "0") return oracleRawToNumber(m.strikeRaw);
  return null;
}

/** Last fill at or before `t` from fills sorted ascending by ts. */
export function lastFillAtOrBefore(fills: FillLite[], t: number): FillLite | null {
  let out: FillLite | null = null;
  for (const f of fills) {
    if (f.ts <= t) out = f;
    else break;
  }
  return out;
}

/** Recompute window_features for every market in the given series (or all if no filter). */
export function computeFeatures(db: Db, where: { network?: string; venueId?: string } = {}): number {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (where.network) (clauses.push("network = ?"), params.push(where.network));
  if (where.venueId) (clauses.push("lower(venueId) = lower(?)"), params.push(where.venueId));
  const sql = `SELECT marketId, asset, tradingStart, expiry, quoteDecimals, baseDecimals, strikeRaw, openingAnswerRaw, closingAnswerRaw
               FROM markets ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""}`;
  const markets = db.prepare(sql).all(...params) as unknown as MarketLite[];

  const fillsStmt = db.prepare("SELECT ts, fillPriceRaw, quantityRaw FROM fills WHERE marketId = ? ORDER BY ts ASC");
  const spotStmt = db.prepare("SELECT spotRaw FROM price_points WHERE symbol = ? AND ts <= ? ORDER BY ts DESC LIMIT 1");
  const upsert = db.prepare(`INSERT OR REPLACE INTO window_features (
      marketId, nTrades, firstTradeProb, vwapProb,
      lastTradeProbAtT30, lastTradeProbAtT60, lastTradeProbAtT120,
      lastTradeAgeAtT30, lastTradeAgeAtT60, lastTradeAgeAtT120,
      openRef, closeRef, spotAtT30, spotAtT60, spotAtT120,
      moveBpsAtT30, moveBpsAtT60, moveBpsAtT120
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  let n = 0;
  db.exec("BEGIN");
  try {
    for (const m of markets) {
      const fills = fillsStmt.all(m.marketId) as unknown as FillLite[];
      const probs = fills.map((f) => priceRawToProb(f.fillPriceRaw, m.quoteDecimals));
      const qtys = fills.map((f) => Number(f.quantityRaw));
      const qtySum = qtys.reduce((a, b) => a + b, 0);
      const vwap = qtySum > 0 ? probs.reduce((a, p, i) => a + p * qtys[i]!, 0) / qtySum : null;
      const openRef = referencePrice(m);
      const closeRef = m.closingAnswerRaw && m.closingAnswerRaw !== "0" ? oracleRawToNumber(m.closingAnswerRaw) : null;
      const symbol = `${m.asset.toUpperCase()}/USDC`;

      const perT = T_SECS.map((t) => {
        const at = m.expiry - t;
        const lf = lastFillAtOrBefore(fills, at);
        const spotRow = spotStmt.get(symbol, at) as { spotRaw: string } | undefined;
        const spot = spotRow ? feedRawToNumber(spotRow.spotRaw) : null;
        return {
          prob: lf ? priceRawToProb(lf.fillPriceRaw, m.quoteDecimals) : null,
          age: lf ? at - lf.ts : null,
          spot,
          move: spot !== null && openRef !== null ? moveBps(spot, openRef) : null,
        };
      });

      upsert.run(
        m.marketId,
        fills.length,
        probs[0] ?? null,
        vwap,
        perT[0]!.prob, perT[1]!.prob, perT[2]!.prob,
        perT[0]!.age, perT[1]!.age, perT[2]!.age,
        openRef, closeRef,
        perT[0]!.spot, perT[1]!.spot, perT[2]!.spot,
        perT[0]!.move, perT[1]!.move, perT[2]!.move,
      );
      n++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return n;
}

export function binOf(prob: number): number {
  const b = Math.floor(prob * N_BINS);
  return Math.max(0, Math.min(N_BINS - 1, b));
}

/**
 * Rebuild the calibration table: for each series and T, bucket the last traded
 * YES probability at (expiry - T) into N_BINS bins and count Up wins. Voided
 * windows and windows without a print at or before T are excluded.
 * `maxStaleSec` drops prints older than that at decision time (null = no limit).
 */
export function computeCalibration(db: Db, opts: { network?: string; maxStaleSec?: number | null } = {}): number {
  const maxStale = opts.maxStaleSec ?? null;
  const rows = db
    .prepare(
      `SELECT m.network, m.venueId, m.asset, m.intervalSec, m.winningOutcome, m.voided,
              f.lastTradeProbAtT30, f.lastTradeProbAtT60, f.lastTradeProbAtT120,
              f.lastTradeAgeAtT30, f.lastTradeAgeAtT60, f.lastTradeAgeAtT120
       FROM markets m JOIN window_features f ON f.marketId = m.marketId
       WHERE m.voided = 0 AND m.winningOutcome IS NOT NULL ${opts.network ? "AND m.network = ?" : ""}`,
    )
    .all(...(opts.network ? [opts.network] : [])) as unknown as {
    network: string; venueId: string; asset: string; intervalSec: number; winningOutcome: number; voided: number;
    lastTradeProbAtT30: number | null; lastTradeProbAtT60: number | null; lastTradeProbAtT120: number | null;
    lastTradeAgeAtT30: number | null; lastTradeAgeAtT60: number | null; lastTradeAgeAtT120: number | null;
  }[];

  const acc = new Map<string, { network: string; venueId: string; asset: string; intervalSec: number; tSec: number; bin: number; n: number; upWins: number; sumProb: number }>();
  for (const r of rows) {
    const per: [number, number | null, number | null][] = [
      [30, r.lastTradeProbAtT30, r.lastTradeAgeAtT30],
      [60, r.lastTradeProbAtT60, r.lastTradeAgeAtT60],
      [120, r.lastTradeProbAtT120, r.lastTradeAgeAtT120],
    ];
    for (const [tSec, prob, age] of per) {
      if (prob === null) continue;
      if (maxStale !== null && age !== null && age > maxStale) continue;
      const bin = binOf(prob);
      const key = `${r.network}|${r.venueId.toLowerCase()}|${r.asset}|${r.intervalSec}|${tSec}|${bin}`;
      const cur = acc.get(key) ?? { network: r.network, venueId: r.venueId.toLowerCase(), asset: r.asset, intervalSec: r.intervalSec, tSec, bin, n: 0, upWins: 0, sumProb: 0 };
      cur.n++;
      cur.sumProb += prob;
      if (r.winningOutcome === 0) cur.upWins++;
      acc.set(key, cur);
    }
  }

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM calibration ${opts.network ? "WHERE network = ?" : ""}`).run(...(opts.network ? [opts.network] : []));
    const ins = db.prepare("INSERT INTO calibration (network, venueId, asset, intervalSec, tSec, bin, n, upWins, sumProb) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const c of acc.values()) ins.run(c.network, c.venueId, c.asset, c.intervalSec, c.tSec, c.bin, c.n, c.upWins, c.sumProb);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return acc.size;
}
