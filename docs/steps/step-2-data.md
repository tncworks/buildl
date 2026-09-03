# Step 2 — Data service

Date: 2026-09-04

## What was done

`services/data` pulls settled markets and everything needed to replay them into one SQLite file (`data/calibrate.sqlite`, Node's built-in `node:sqlite`, WAL mode, 5 s busy timeout so the sync, runners and the web app can share it).

Files:
- `src/db.ts` — schema (`markets, fills, orders, price_points, window_features, calibration, book_snapshots, meta`), open/transaction helpers. `DATA_DB` resolves relative to the directory holding `.env`, so every entry point (CLI from the root, `npm -w` from a workspace, the web app) opens the same file.
- `src/client.ts` — read-only `SomniaMarkets` per network (no key), `.env` loading, endpoint overrides.
- `src/gql.ts` — the only raw GraphQL: `Order` rows by `market_id` (the SDK's `getOrders` is per owner) and `PricePoint` pagination by `blockTimestamp` (the SDK's `fetchPriceHistory` has no cursor). Retries with backoff.
- `src/sync.ts` — the CLI. Pages `listPastBinaryMarkets` per (asset, interval) until older than `--days`; per new market fetches `getFills` (kept only where `fill.market == marketId`, because pools are recycled), orders, `getMarketResolution`; batches `getOpeningPrices`; streams price ticks per asset for the covered range (backfilling before the oldest stored tick and extending after the newest); then recomputes features and calibration.
- `src/features.ts` — per-window features (last print at T−30/60/120 and its age, VWAP, opening/closing reference, spot and move at each T) and the calibration table (20 bins × 3 decision times per series).
- `src/queries.ts` — read API for the backtester and the web app.
- `src/bookstate.ts` — order-book reconstruction from order rows (step 8).
- `src/spotcheck.ts`, `src/stats.ts`, `src/verify-calibration.ts`, `src/compare-book.ts` — verification tools.

## Verification

Full sync (`npm run sync -- --days 5 --assets BTC,ETH --intervals 300,900,3600`, log in `docs/verification/sync-5d.log`): 33 minutes wall clock, 3,639 markets in the detail phase at concurrency 4, then 484k price ticks.

```
totals { markets: 3920, fills: 4729, orders: 1192383, ticks: 483729 }
features for 3920 markets; calibration cells 354
```

Per series (venue 0x6797…, testnet, 2026-08-30 → 2026-09-03):

| Series | Windows | Traded | Trades |
|---|---|---|---|
| BTC/300s | 1,406 | 325 | 829 |
| ETH/300s | 1,348 | 287 | 750 |
| BTC/900s | 475 | 270 | 1,109 |
| ETH/900s | 456 | 259 | 1,039 |
| BTC/3600s | 120 | 80 | 497 |
| ETH/3600s | 115 | 74 | 505 |

Gate "≥ 2,000 markets": 3,920. Trading on the venue is concentrated in the last ~36 hours; only 20–25 % of 300s windows over the five days carry a print, which is why every statistic in the UI shows its sample size.

Spot-check (`npm run spotcheck`, most-traded window, `docs/verification/spotcheck-final.log`): stored fill count equals a fresh `getFills` read for the same market id, the stored opening and closing answers reproduce the indexer's `winningOutcome` (`close ≥ open → UP`, MATCH), and the fresh `getBinaryMarket` row agrees on status, outcome, trade count and expiry.

Order volume is the bulk of the database (1.19 M rows, ~570 MB): market makers requote every few seconds. `--skip-orders` makes a sync several times faster when the book reconstruction is not needed.

## Corrections during the step

- A first pass resumed price ticks from the newest stored tick only, leaving the older four days of BTC ticks unfetched (visible as `no-spot` skips in the backtester). The sync now fills the gap before the oldest stored tick as well as after the newest. Backfill run: `npm run sync -- --days 5 --assets BTC --skip-orders` (`docs/verification/sync-btc-tick-backfill.log`) → ticks 808,051 total; BTC/USDC 402,497 rows from 1788029941 to 1788463505, ETH/USDC 405,554 rows from 1788026341 to 1788463205; `no-spot` skips dropped from 212 to 0 on BTC/300s.
- Venue fees: recorded afterwards with `node scripts/verify/market-fees.mjs` (`docs/verification/market-fees.log`). For two recent BTC/300s markets on venue 0x6797… the indexer reports `makerFeeBps 0, takerFeeBps 0, maxBuilderFeeBps 0, routingFeeBps 0, settlementFeeBps 0`, so the engine's zero-fee assumption holds on this venue.
