# Step 8 — Ladder template, export, order-book reconstruction

Date: 2026-09-04

## Ladder template

`services/backtest/src/templates.ts` (`ladderRungs`) and `engine.ts` (`runLadder`). Rungs are evenly spaced between `low_price` and `high_price`; a rung is counted filled only if a later print traded at or below it; everything filled is held to settlement. The UI labels this as an upper bound on fills (queue position and partial fills are not simulated). Unit-tested in `tests/engine.test.ts` with hand-computed costs and payouts. The runner rests the rungs post-only through ec-core `placeLimit`; their expiry is capped at market expiry so nothing needs cancelling when the window locks.

## Export (`/export`)

`apps/web/src/components/ExportStudio.tsx` renders a Bot Kit `.env` for the closest strategy:

| Calibrate template | Bot Kit strategy | Mapped | Not mapped (shown on the page) |
|---|---|---|---|
| Momentum vs opening price | `ec-oracle-follow` (`OF_MODEL=momentum`) | `move_bps → OF_MOMENTUM_THRESHOLD` (fraction), `size → OF_MAX_SHARES`, `seconds_left → OF_NEAR_EXPIRY_STOP_MS` (half) | `max_price`, `slippage_ticks`, `stale_sec` (the bot uses `OF_EDGE`) |
| Probability ladder | `ec-laddering-bot` | `rungs → GRID_LEVELS`, low/high → `GRID_SPACING` + `GRID_CENTER`, `size_per_rung → GRID_SIZE` | `side_up`, `delay_sec` |
| Late-window mispricing | none | — | needs the calibration table; the page prints the Calibrate runner command instead |

Every variable name comes from the strategies' README config tables in the cloned Bot Kit (verified 2026-09-03). The page states that the Bot Kit strategies are different programs and that the export carries sizing and thresholds, not the backtest.

Gate "export runs under the Bot Kit in DRY_RUN=true": **done**, with one correction. In the cloned Bot Kit (`npm install` exit 0, `docs/verification/botkit-install.log`):

1. With the exported file as the kit's `.env` (`docs/verification/botkit-export.env`, testnet variant), `npm start -w ec-oracle-follow` started, warmed up, logged two intended takes (`DRY BUY_NO 5 BTC-0-03SEP26-1930/tUSDC#NO @ ~0.036 …`, `DRY BUY_NO 5 ETH-…`) and stopped cleanly: `docs/verification/botkit-export-dryrun.log`. But its banner read `model=strike` and it traded both assets: the strategy reads `OF_MODEL` and `EC_UNDERLYING` at module import, before ec-core's `loadEnv()` runs inside `createExchange()`. A bare `.env` only reaches the variables ec-core itself reads (network, venue, key).
2. With the same variables exported into the shell (`set -a; source .env; set +a`), the banner read `model=momentum` and only BTC was warmed up (4 tradable markets): `docs/verification/botkit-export-dryrun-shellenv.log`. The run was cut by the 75 s timeout during warm-up, so it logged no take in that window.

The export page now says to apply the variables as process environment (Railway variables or a shell export) rather than as a `.env` file.

## Order-book reconstruction

`services/data/src/bookstate.ts` rebuilds best bid/ask at a second `ts` from indexer `Order` rows: placed at or before `ts`, not expired, and either still Open or last updated after `ts`. Known inaccuracy: `lastUpdatedAtTimestamp` moves on every fill, so an order partially filled before `ts` counts at full size.

It is exposed as the optional `fillModel: "book"` in the engine (`--fill book` on the CLI, a toggle on `/backtest`). Buying Up crosses the reconstructed YES ask; buying Down crosses the YES bid at `1 − bid` (SELL_NO and BUY_YES rest on the same side).

Comparison on BTC/300s momentum (`move_bps 2`, `seconds_left 60`, five days, after the tick backfill; `npm run backtest -- … --fill print|book`):

| Fill model | Trades | Hit rate (95 % CI) | Total PnL | Mean PnL / contract | Max drawdown |
|---|---|---|---|---|---|
| last print + 2 ticks | 38 | 89.5 % (76–96) | 32.64 | 0.1718 | 7.09 |
| reconstructed book + 2 ticks | 17 (25 more skipped as `no-book`, 4 fewer pass `price-cap`) | 82.4 % (59–94) | 1.46 | 0.0172 | 8.24 |

The last print is usually where a maker got hit, i.e. near the bid; the taker pays the ask. The book model is the more honest cost estimate for taker templates and the UI says so.

Gate "accuracy comparison against runner snapshots": **done**. `services/data/src/compare-book.ts` compared every `book_snapshots` row written by the dry-run runners (exact `getBinaryOrderBook` reads, 3 s cadence) with the reconstruction at the same second, after those windows finalized and an incremental sync fetched their orders (`docs/verification/compare-book.log`):

```
126 snapshots compared: best bid exact 97 (77%), within 1 tick 97; best ask exact 99 (79%), within 1 tick 99
```

Every mismatch is a timing offset: the maker on this venue requotes every few seconds, and the reconstruction at second `ts` shows the quote from the previous or next requote (e.g. snapshot 424000/454000 vs reconstructed 409000/439000 one second apart). Per-second timestamps in the indexer versus the block time of the chain read explain the rest. Conclusion: the reconstruction is a fair estimate of the standing quote and a better taker-cost estimate than the last print, but it is not exact, which is how the UI labels it.
