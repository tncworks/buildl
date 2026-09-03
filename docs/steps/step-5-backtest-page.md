# Step 5 — Backtest page

Date: 2026-09-04

## What was done

- `apps/web` is a Next.js 16.3.4 app (App Router, `src/` layout) with Tailwind v4 (`@tailwindcss/postcss`, `@import "tailwindcss"` and an `@theme inline` block mapping CSS variables to Tailwind colour tokens; light and dark palettes via `prefers-color-scheme`).
- `next.config.ts`: `transpilePackages` for the three workspace packages (they ship TypeScript source) and `serverExternalPackages` for the SDK and viem.
- `/backtest` (`src/app/backtest/page.tsx` + `src/components/BacktestStudio.tsx`): series chips, template cards, one slider per parameter generated from the template spec (range, step, help text), a fill-model toggle (last print / reconstructed book), summary tiles (trades, hit rate with Wilson 95% interval, total PnL and per-contract PnL, max drawdown, run time), the equity curve, skip-reason badges, and the decision table with each trade's print, age, price, outcome, PnL and the template's reason string. Skipped windows are one click away.
- `POST /api/backtest` (`src/app/api/backtest/route.ts`) clamps every parameter to its declared range and runs the engine in-process against the SQLite file.
- Charts are inline SVG (`CalibrationChart.tsx`, `EquityChart.tsx`), server-renderable, drawn to scale with theme-token colours.
- Deep links: `/backtest?asset=BTC&interval=300&template=mispricing&seconds_left=60` seeds the studio; the map page's "Backtest this edge" button uses this.

## Verification

```
$ npm run typecheck -w @calibrate/web         # 0 errors (ES2022 target; incremental cache cleared)
$ curl -s -X POST http://localhost:3210/api/backtest -H 'content-type: application/json' \
    -d '{"asset":"BTC","intervalSec":300,"template":"momentum","params":{"move_bps":2,"seconds_left":60}}'
{"windows":1406,"eligible":1406,"trades":24,"wins":22,"hitRate":0.9167,"hitRateCi95":[0.742,0.977],
 "totalPnl":18.42,"meanPnlPerContract":0.1535,"maxDrawdown":7.085, ...}  ms: 31
$ for p in / /backtest /deploy /export; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:3210$p; done
/ 200   /backtest 200   /deploy 200   /export 200
```

Gate ("changing a parameter re-runs in < 3 s on 2,000 windows"): the route handler reports its own run time; 1,406 windows ran in 28–37 ms, and the page debounces slider input by 250 ms. Screenshot: `docs/screenshots/backtest.png` (headless Chromium, 1280×1100).

## Notes

- The dev server runs on port 3210 because another Next app on this machine already holds port 3000.
- Turbopack could not resolve `.js`-suffixed relative imports inside the workspace packages; they were made extensionless (see step 1 notes).
- The pitch's "Backtest this edge" flow is real: the map page links straight into the studio with the series, template and decision time pre-filled.
