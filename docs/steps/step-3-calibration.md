# Step 3 — Calibration map

Date: 2026-09-04

## What was done

- `computeCalibration` (`services/data/src/features.ts`): for each series and each decision time T ∈ {30, 60, 120} s before expiry, the last traded YES price at or before `expiry − T` is bucketed into 20 bins; per bin the window count, Up wins and summed price are stored. Voided windows and windows with no print at or before T are excluded.
- `/` (`apps/web/src/app/page.tsx` + `CalibrationChart.tsx`): series chips with traded/total counts, decision-time switch, the map (x = mean traded price in the bin, y = realized Up rate, dot radius ∝ √n, Wilson 95 % bars, colour by edge sign), the three summary tiles (windows with a print at T, realized Up rate vs mean price, largest edge among bins with n ≥ minN), a "Backtest this edge" deep link, and the full bin table.

## Verification

Gate "numbers reproduce from a standalone SQL query": `services/data/src/verify-calibration.ts` recomputes the bins for one series with a single SQL statement over `markets` + `fills` (correlated subquery for the last fill at or before `expiry − T`, `floor(prob × 20)` clamped), bypassing `window_features` and the TypeScript, then diffs against the stored table.

```
$ npx tsx services/data/src/verify-calibration.ts BTC 300 30    → ALL BINS MATCH
$ npx tsx services/data/src/verify-calibration.ts BTC 300 60    → ALL BINS MATCH
$ npx tsx services/data/src/verify-calibration.ts BTC 300 120   → ALL BINS MATCH
$ npx tsx services/data/src/verify-calibration.ts ETH 300 60    → ALL BINS MATCH
```

(An earlier run during the sync reported mismatches: the stored table was built at the end of the one-day sync while the five-day sync kept adding fills. The table is a derived artifact rebuilt at the end of every sync, which is why the check must run after a sync completes.)

BTC/300s at T−60s (n = 311 windows with a print), from `npm run stats -- BTC 300`:

| Price bin | n | Mean price | Up rate | Edge |
|---|---|---|---|---|
| 0.00–0.05 | 18 | 0.027 | 0.000 | −0.027 |
| 0.05–0.10 | 13 | 0.075 | 0.154 | +0.079 |
| 0.10–0.15 | 15 | 0.121 | 0.000 | −0.121 |
| 0.15–0.20 | 11 | 0.178 | 0.273 | +0.095 |
| 0.20–0.25 | 16 | 0.222 | 0.125 | −0.097 |
| 0.25–0.30 | 12 | 0.271 | 0.000 | −0.271 |
| 0.30–0.35 | 12 | 0.325 | 0.417 | +0.092 |
| 0.35–0.40 | 20 | 0.373 | 0.400 | +0.027 |
| 0.40–0.45 | 11 | 0.431 | 0.727 | +0.296 |
| 0.45–0.50 | 24 | 0.481 | 0.625 | +0.144 |
| 0.50–0.55 | 27 | 0.520 | 0.630 | +0.110 |
| 0.55–0.60 | 28 | 0.575 | 0.500 | −0.075 |
| 0.60–0.65 | 20 | 0.628 | 0.550 | −0.078 |
| 0.65–0.70 | 9 | 0.666 | 0.778 | +0.111 |
| 0.70–0.75 | 14 | 0.720 | 0.643 | −0.077 |
| 0.75–0.80 | 10 | 0.772 | 1.000 | +0.228 |
| 0.80–0.85 | 8 | 0.819 | 0.875 | +0.056 |
| 0.85–0.90 | 11 | 0.877 | 0.909 | +0.032 |
| 0.90–0.95 | 5 | 0.924 | 0.800 | −0.124 |
| 0.95–1.00 | 27 | 0.973 | 1.000 | +0.027 |

Reading it honestly: the extremes are well calibrated (prices under 0.05 never won, prices over 0.95 always won), the middle is noisy at 10–30 windows per bin, and the Wilson bars on the page make that visible. The walk-forward mispricing backtest on this series (edge 0.10, min 10 per bucket) came out at 15 trades, 53 % hit rate, −1.37 PnL: the map shows where to look, it does not yet show a robust exploitable edge at this sample size. The page and the backtest both say so through their sample counts and intervals.

Page rendering: `GET /` → 200, contains the map, both tiles and the deep link (`curl` + grep in step 5's log); screenshot `docs/screenshots/map.png`.
