# Step 7 — Runner, deploy page, live page

Date: 2026-09-04. Status: dry-run path verified end to end; live-fire waits on step 6 (STT gas).

## What was done

### Runner (`services/runner/src/runner.ts`)

One process, one key, one series, one template. Started with `STRATEGY_JSON` and the usual `.env`; `PRIVATE_KEY` only in its own environment. It refuses to start when `NETWORK=mainnet`.

Per tick (default 3 s):
1. Reads tick/lot/minQuantity from the first live pool on chain (`getBinaryBookParams`) and passes them to ec-core as `MM_TICK`/`MM_LOT`, overriding the kit's defaults (its testnet lot default of 1 disagrees with the on-chain 1000).
2. `activeMarkets` (ec-core → `loadMarkets`) filtered to the series, then `getMarketOnchain` for each; only `status === 1` proceeds.
3. Snapshots the chain book (`getBinaryOrderBook`) into `book_snapshots` every tick, for every live market. This is the exact history the step 8 comparison uses.
4. Builds the same `DecisionContext` the backtester uses: last print from `getFills(pool, {since: tradingStart})` filtered to this market's id (pools are recycled), spot from `fetchPrice`, opening reference from `getOpeningPrices` with `strike` fallback, calibration from the SQLite table (nearest of T−30/60/120).
5. Calls the identical template function (`decideMomentum` / `decideMispricing`) and applies the identical acceptance rules (stale print, price cap) before placing an IOC through ec-core `placeLimit`, which snaps to grid, caps expiry at market expiry and asserts the receipt. The ladder template rests post-only rungs whose expiry ec-core caps at market expiry, so nothing needs cancelling at lock.
6. `maybeClaim` (ec-core) sweeps settled markets on the same loop and key; `settlePositions` reports realized PnL per trade from `getMarketOnchain` after expiry.
7. Emits one JSON event per line: `bookParams, start, decision, order, settled, warn, error, stopping, cancelled, stop`.

On SIGTERM/SIGINT it cancels tracked resting orders (`cancelTracked`), closes the SDK, and exits 0.

### Web

- `src/lib/runners.ts` — registry on `globalThis` (survives HMR), spawns `tsx services/runner/src/runner.ts` with the key in the child env only, buffers events, appends them to `data/runs/<id>.jsonl`.
- `POST/GET /api/runners`, `GET/DELETE /api/runners/[id]`, `GET /api/runners/[id]/events` (SSE replay + live).
- `GET/POST /api/wallet` — balances (STT, tUSDC) via viem; faucet call via the SDK trader (refuses when the address has no STT).
- `/deploy` — burner key generated in the browser (`viem/accounts.generatePrivateKey`), kept in `sessionStorage`, balances, faucet button, strategy form, dry-run toggle, runner table.
- `/live/[id]` — event stream, decision/order/settled counters, live equity, and the backtest projection for the same parameters shown beside it.

## Verification

Direct dry run (no key), 45 s, `docs/verification/runner-dryrun.jsonl`:
```
{"type":"bookParams","pool":"0x4775eb5d…","tickSize":"1000","lotSize":"1000","minQuantity":"1000"}
{"type":"start","network":"testnet","venueId":"0x679795a0…","address":null,"dryRun":true,...}
```
Four `book_snapshots` rows were written (one per tick, one live market). No decision was due: the live window had 276–303 s left and the threshold was 240 s.

Through the web API (`docs/verification/` + `data/runs/16cbb0451b15.jsonl`):
```
POST /api/runners {"asset":"BTC","intervalSec":300,"template":"momentum","params":{"move_bps":0,"seconds_left":120},"dryRun":true}
→ {"id":"16cbb0451b15"}
GET /api/runners/16cbb0451b15/events (SSE) → bookParams, start, decision(secondsLeft 75, side DOWN, skipped no-fresh-print, printAge 1711)
DELETE /api/runners/16cbb0451b15 → {"stopped":true}
GET /api/runners/16cbb0451b15 → exitCode 0; events: bookParams, start, decision, stopping, stop, exit
```
`/live/16cbb0451b15` returned 200. Wallet route cross-checked against direct RPC reads for four addresses (`scripts/verify/wallet-route.mjs`): all MATCH, including a funded one (40.3 STT, 18,347 tUSDC).

Correction made during verification: the first version read prints with the unified `fetchTrades(symbol)`, which returned a fill from a previous window on the same recycled pool (print age 1,711 s). The runner now reads `getFills(pool, {since: tradingStart})` and keeps only rows whose `market` equals this window's id. A second dry run with the fix is in `docs/verification/runner-dryrun2.jsonl`.

## Remaining for this step

- Live fire on testnet (a real IOC and a fill on `/live`) needs STT on a burner. See step 6.
- "Stop leaves zero open orders" can only be checked with a live run; the code path (`cancelTracked`) is ec-core's and exercised by the kit's own gate tests.
