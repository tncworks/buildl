import type { SkipReason, Summary, WindowResult } from "./types.js";

/** Wilson score interval for a binomial proportion, 95%. */
export function wilson95(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.959964;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function summarize(results: WindowResult[]): Summary {
  const skipped: Partial<Record<SkipReason, number>> = {};
  let eligible = 0;
  let trades = 0;
  let wins = 0;
  let totalPnl = 0;
  let contracts = 0;
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  const equity: { expiry: number; cum: number }[] = [];
  for (const r of results) {
    if (r.skipped === "no-outcome") {
      skipped[r.skipped] = (skipped[r.skipped] ?? 0) + 1;
      continue;
    }
    eligible++;
    if (r.skipped) {
      skipped[r.skipped] = (skipped[r.skipped] ?? 0) + 1;
      continue;
    }
    if (r.pnl === null || r.price === null) continue;
    trades++;
    if (r.pnl > 0) wins++;
    totalPnl += r.pnl;
    contracts += r.size;
    cum += r.pnl;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    equity.push({ expiry: r.expiry, cum: Number(cum.toFixed(6)) });
  }
  return {
    windows: results.length,
    eligible,
    trades,
    wins,
    hitRate: trades ? wins / trades : null,
    hitRateCi95: trades ? wilson95(wins, trades) : null,
    totalPnl: Number(totalPnl.toFixed(6)),
    meanPnlPerContract: contracts ? Number((totalPnl / contracts).toFixed(6)) : null,
    maxDrawdown: Number(maxDd.toFixed(6)),
    skipped,
    equity,
  };
}
