# Calibrate — Execution Plan

Status: executed 2026-09-04. Step records with verification output are in `docs/steps/`; see `docs/README.md` for the gate table. Steps 6 and the live-fire half of 7 wait on STT gas for the burner `0x889AD6CC21b22586E144ac1bc8CfFb088C34Fe3F`.
Written: 2026-09-03. Every fact below is tagged with how it was verified. Nothing is assumed from docs alone.

Verification evidence lives in `docs/verification/*.log` (raw outputs) and `scripts/verify/*.mjs` (the scripts that produced them, rerunnable with `node`). SDK references are to `@somnia-chain/markets-sdk@0.28.1` files under `node_modules/@somnia-chain/markets-sdk/dist/`.

---

## 1. What we are building

A web app where a user picks a settlement-payoff strategy for DreamDEX Event Contracts, backtests it against every settled window (real fills, real oracle prices, real outcomes), tunes parameters, and deploys it as a live testnet bot from a burner wallet. The headline visual is a calibration map: traded Up-probability at T seconds before expiry versus realized Up win rate.

Scope decisions (final):
- Backtest only strategies whose payoff comes from settlement, not from resting fills.
- Hosted live bots run on testnet only, from a burner key generated in the browser.
- Mainnet gets a config export for the Bot Kit, never a hosted key.
- Templates: Momentum vs opening price, Late-window mispricing, Probability ladder.

---

## 2. Verified facts

### 2.1 SDK surface (verified against installed type definitions)

Package `@somnia-chain/markets-sdk@0.28.1` installs cleanly on Node 24.19 with `viem@2.56.3` (`docs/verification/` and `npm ls` in the probe workspace).

Main entry exports (verified by `Object.keys(await import(...))`, see `chainprobe.log` header and probe run): `SomniaMarkets`, `SOMNIA_TESTNET_ADDRESSES`, `SOMNIA_MAINNET_ADDRESSES`, `SOMNIA_TESTNET_PRICE_FEED`, `ORDER_TYPE`, `probabilityToPrice`, `priceToProbability`, `fromHuman`, `toHuman`, `isBinaryMarket`, `CANDLE_INTERVALS`, ABIs (`binaryModuleReadAbi`, `binaryModuleWriteAbi`, `binarySettlementAbi`, `erc6909Abi`, `oracleHubAbi`, `binaryPoolWriteAbi`).

**Correction to the docs:** `createClient` is NOT exported from the main entry in 0.28.1 (import throws `does not provide an export named 'createClient'`). Construct `new SomniaMarkets({...})` and use `.client` for reads and `.trader` for writes. `unified/exchange.d.ts:14` defines `SomniaMarketsConfig = ClientConfig & Pick<TraderConfig, "privateKey" | "account" | "walletClient">`, so the private key is optional and read-only construction works (verified: all indexer probes ran without a key).

Chains: `@somnia-chain/markets-sdk/chains` exports `somniaShannon` (50312) and `somniaMainnet` (5031), both carrying a WebSocket RPC (`chains/index.d.ts`). Using these means `wsRpcUrl` is optional (`config.d.ts:221-230`).

Read methods on `exchange.client` (all in `somniaMarketsClient.d.ts`, line numbers noted):

| Method | Line | Signature |
|---|---|---|
| `listPastBinaryMarkets` | 561 | `(opts?: BinaryMarketFilter & {limit?, offset?, nowSec?}) => Promise<BinaryMarket[]>` |
| `listLiveBinaryMarkets` | 532 | `(filter?: same shape) => Promise<BinaryMarket[]>` |
| `listBinaryMarkets` | 523 | `(opts?: BinaryMarketFilter & {limit?}) => Promise<BinaryMarket[]>` |
| `countBinaryMarkets` | 553 | `(opts: BinaryMarketFilter & {phase: "live"\|"past", nowSec?}) => Promise<number>` |
| `listBinaryVenueIds` | 538 | `() => Promise<{operatorId, venueId}[]>` |
| `listBinaryAssets` | 548 | `() => Promise<string[]>` |
| `getCandles` | 612 | `(poolAddress, intervalSeconds, {limit?, from?, to?}) => Promise<Candle[]>` |
| `getFills` | 621 | `(pool, {limit?, offset?, since?, until?}) => Promise<FillRow[]>` |
| `getOrders` | 644 | `(owner, {pool?, status?, side?, limit?, offset?}) => Promise<OrderRow[]>` |
| `getMarketResolution` | 827 | `(marketId) => Promise<{events, reference, closingAnswer, openingAnswer, oracleAnswer}>` |
| `getOpeningPrices` | 854 | `(marketIds: string[]) => Promise<Record<string, string\|null>>` |
| `getMarketStatusHistory` | 591 | `(marketId) => Promise<MarketStatusUpdate[]>` |
| `getMarketOnchain` | 1556 | `(marketId: Hex) => Promise<MarketOnchain>` |
| `getOutcomeBalance` | 1605 | `(p: GetOutcomeBalanceParams) => Promise<bigint>` |
| `getBinaryBookParams` | 303 | `(pool) => Promise<{tickSize, minQuantity, lotSize}>` (bigints) |
| `getBinaryOrderBook` | 1033 | `(pool, {depth?, decimals?}) => Promise<{yesBids, yesAsks, noBids, noAsks}>` (chain read) |
| `getAllOpenOrdersOnchain` | 1070 | `(pool, {isBid}) => ...` (verified returns `{orders:[{orderId, isBid, owner, price, fullQuantity, quantityRemaining, expireTimestampNs}]}`) |
| `fetchPriceHistory` | 476 | `(asset, {limit?, from?, to?}) => Promise<PricePoint[]>` |
| `fetchPriceCandles` | 485 | `(asset, "M1"\|"H1"\|"D1", {limit?, from?, to?}) => Promise<PriceCandle[]>` |

`BinaryMarketFilter` (`markets.d.ts:407`): `operatorId?, venueId?, asset?, intervalSec?, status?, search?, creator?, orderBy?`. `status` accepts `"Listed"|"Trading"|"Locked"|"Settling"|"Resolved"|"Voided"|"Finalized"` (`store.d.ts:25`).

`BinaryMarket` row fields we rely on (`markets.d.ts:168-310`, values confirmed in `indexerprobe.log`): `marketId`, `poolAddress`, `asset`, `intervalSec`, `strike`, `tradingStart`, `expiry`, `status`, `winningOutcome`, `voided`, `finalized`, `tradeCount`, `cumulativeQuoteVolume`, `cumulativeBaseVolume`, `lastPrice`, `quoteDecimals`, `baseDecimals`, `venueId`, `operatorId`, `nonce`, `oracleQuestionId`, `payoutNumerators`.

`FillRow` (`fills.d.ts`): `id, market, pool, fillPrice, quantity, quoteQuantity, maker, makerSide, taker, takerSide, kind, takerIsBid, takerOrder, timestamp, txHash`. `kind` values seen: `DIRECT_YES`, `BURN_A_PAIR`. `market` is the stable id; `pool` is recycled (doc comment in `fills.d.ts`, and confirmed: every fill's `market` matched the sample marketId).

`MarketOnchain` (`markets.d.ts:686`): `marketAddress, outcomeToken, yesId, noId, pool, nonce, collateral, status, backing, finalized, expiry, decimals, winningOutcome, isResolved, isVoided`. Status codes 0 Listed, 1 Trading, 2 Locked, 3 Settling, 4 Resolved, 5 Voided (`store.d.ts:25-27`, and `redeem.mjs` in the template). Verified: a finalized market returned `status: 4, finalized: true, isResolved: true`.

Write methods on `exchange.trader` (`trade.d.ts`):

| Method | Line | Params (verified interface) |
|---|---|---|
| `placeOrder` | 1449 | `{pool, side: "BUY_YES"\|"SELL_YES"\|"BUY_NO"\|"SELL_NO", price: bigint, quantity: bigint, expireTimestampNs?: bigint, orderType?: number, autoApprove?, ...}` returns `{hash, receipt, orderId?, fills: OrderFill[]}` |
| `cancelOrder` | 1457 | `{pool, orderId: bigint\|string, gas?}` |
| `mintSet` | 1835 | `{pool, amount: bigint, collateral?, autoApprove?, gas?}` |
| `burnSet` | 1837 | `{pool, amount: bigint, outcomeToken?, autoApprove?, gas?}` |
| `redeem` | 1844 | `{marketId: Hex, amount: bigint, outcomeIdx?: 0\|1, market?, operatorId?, venueId?, outcomeToken?}` |
| `faucet` | 1965 | `{amount?: bigint, testUsdc?, gas?}` default 10,000 × 10^decimals |

`ORDER_TYPE` (`trade.d.ts:246`): `LIMIT: 0, FILL_OR_KILL: 1, MARKET: 2 (IOC), POST_ONLY: 3`.

`placeOrder.expireTimestampNs` defaults to the pool's market expiry when omitted (`trade.d.ts:119-124`). Passing a value beyond it reverts `OrderExpiryBeyondMarket`.

`TxResult` is `{hash, receipt}` and the SDK does not throw on a reverted receipt (documented in bot-kit `packages/ec-core/src/exchange.ts:60-73`, which is why `assertTxOk` exists).

React hooks exist at `@somnia-chain/markets-sdk/react` (`react.d.ts`): `SomniaMarketsProvider`, `useLiveBinaryOrderBook`, `useLiveFills`, `useLivePrice`, `useLiveMarkets`, `useCandles`, `usePortfolio`, and others.

### 2.2 Networks and contracts (verified by RPC calls, `chainprobe.log`)

| | Testnet (Shannon) | Mainnet |
|---|---|---|
| Chain id | 50312 | 5031 |
| HTTP RPC (responds) | `https://dream-rpc.somnia.network`, `https://api.infra.testnet.somnia.network` | `https://api.infra.mainnet.somnia.network` |
| WS RPC | `wss://api.infra.testnet.somnia.network/ws` | `wss://api.infra.mainnet.somnia.network/ws` |
| Indexer (responds) | `https://dev.smk.somnia.host/v1/graphql` | `https://prd.smk.somnia.host/v1/graphql` |
| Gas price observed | 6 gwei | 6 gwei |
| Collateral | tUSDC `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`, 6 decimals | USDso `0x00000022dA000002656c64D9eA6011ea952D008A`, 18 decimals |
| Tick / lot / minQty (on-chain `getBinaryBookParams`) | 1000 / 1000 / 1000 raw (0.001 prob, 0.001 contracts) | 1e15 / 1e15 / 1e15 raw (0.001 prob, 0.001 contracts) |

Core contracts have code on both chains at the same addresses (CREATE3): `binaryModule 0x3ecC694C…e388`, `marketsCore 0x28025043…0294`, `binarySettlement 0xbF4a49e0…6Ed23`, `outcomeToken 0xB52c5934…55b9` (seen in `getMarketOnchain`), `oracleHub 0xe40db387…dE32b`, `collateralRouter 0xbC0C9834…183C`, `clobFactory 0xb2BE8EE0…fF04`, `binaryPoolImpl 0x82A1Fcda…66FD`, `marketCreatorFactory 0xE6bEE93c…4F6B`. Module, core, settlement and hub are 130-byte proxies; pool impl is 37,936 bytes.

The tUSDC bytecode contains the `faucet(uint256)` selector. **Not verified:** that calling it actually mints (needs an STT-funded key; see §4).

SDK's bundled testnet `marketCreator` is `0x138CfA6b…645a`; bot-kit's `ec-core/src/addresses.ts` bundles `0x5Ce69567…44e6`. They disagree. Neither is needed for our flows (discovery goes through the indexer), so we do not depend on either.

### 2.3 Venues (verified via `listBinaryVenueIds` + `listLiveBinaryMarkets`, `indexerprobe.log`, `probe2.log`)

Testnet has 13 venues. The two that carry live markets right now:

| venueId | operatorId | What it runs (from live rows) |
|---|---|---|
| `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` | 2 | BTC and ETH 300s, question "BTC closes at or above its opening price". `strike` field is `0`; opening price comes from `getOpeningPrices`. This is the venue bot-kit's test report calls the testnet DreamDEX venue. |
| `0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f` | 4 | BTC and ETH 60s and 300s, question "Pricefeed test: will BTC/USDC's price be at or above 81176.64 at unix time …". `strike` populated (2-decimal fixed, e.g. `8117664`). `getOpeningPrices` returned nothing for these. |

Mainnet has 4 venues; live markets are on `0x458b30c2…5432d` (operator 5): BTC/ETH 300s, 900s, 3600s.

**Decision:** default `VENUE_ID` = `0x6797…8a28c` on testnet and `0x458b…432d` on mainnet, matching the Bot Kit. The data service ingests all venues and keys by `venueId` so the UI can switch.

### 2.4 Historical data actually available (the backtester's inputs)

Counts via `countBinaryMarkets` (public role caps at 10,000):

| Network | Asset | Past finalized |
|---|---|---|
| testnet | BTC | ≥10,000 |
| testnet | ETH | ≥10,000 |
| mainnet | BTC | 5,760 |
| mainnet | ETH | 4,931 |

Trade density in the most recent 400 finalized rows (`indexerprobe.log`):

| Network | Series | Windows | With ≥1 trade | Total trades |
|---|---|---|---|---|
| testnet | BTC 60s | 134 | 12 | 17 |
| testnet | ETH 60s | 134 | 11 | 22 |
| testnet | BTC 300s | 51 | 48 | 202 |
| testnet | ETH 300s | 50 | 47 | 203 |
| testnet | BTC 900s | 9 | 9 | 107 |
| testnet | ETH 900s | 8 | 8 | 102 |
| testnet | BTC 3600s | 3 | 3 | 142 |
| testnet | ETH 3600s | 3 | 3 | 134 |
| mainnet | BTC 300s | 141 | 22 | 37 |
| mainnet | ETH 300s | 129 | 18 | 18 |
| mainnet | BTC 900s | 47 | 22 | 50 |
| mainnet | ETH 900s | 47 | 11 | 12 |

Conclusion: on testnet the 300s, 900s and 3600s series are traded in nearly every window. The 60s series is mostly empty. Mainnet is thin everywhere. **The demo series is testnet BTC 300s.**

Per settled market, these reads returned real data (`indexerprobe.log`, `probe2.log`):
- `getCandles(pool, 60, {from: tradingStart, to: expiry})` → 42 one-minute candles for a 3600s window, prices on the YES-probability scale in raw collateral units (`520000` = 0.52 on testnet).
- `getFills(pool, {since, until, limit})` → 62 fills, each with `fillPrice`, `quantity`, `timestamp`, `kind`, sides.
- `getMarketResolution(marketId)` → `events[0].winningOutcome`, `payoutNumerators`, `openingAnswer.numericValue`, `closingAnswer.numericValue` (**2-decimal fixed point**: `248937` = 2489.37 ETH, `8117664` = 81176.64 BTC). On the newest venue-0x1a1e rows the answers were `null`; `winningOutcome` on the market row was still populated. Use the row's `winningOutcome`/`voided` as the truth and the answers as enrichment.
- `getOpeningPrices([...])` → map of marketId → 2-decimal fixed string, populated for venue 0x6797 rows, absent for 0x1a1e rows (which carry `strike` instead).
- `getMarketStatusHistory(marketId)` → `[{oldStatus: "Locked", newStatus: "Resolved", timestamp, txHash}]`.

**Order history is queryable per market** (`probe4.log`): raw GraphQL `Order(where:{market_id:{_eq:$id}})` on the indexer returns rows with `orderId, owner, isBid, side, price, fullQuantity, filledQuantity, quantityRemaining, status ("Open"|"Closed"|"Filled"|"Cancelled"|"Expired"), rested, cancelReason, placedAtTimestamp, lastUpdatedAtTimestamp, expireTimestampNs`. `pool` is not a filterable field on `Order`; `market_id` and `owner` are. `_aggregate` fields are hidden on the public role (`Order_aggregate`, `Market_aggregate` both rejected). `status` is not a filterable field on `Market` in raw GraphQL; go through the SDK for market lists.

**Underlying spot price history exists** at the oracle's own price feed, `https://price-feed.dev.oracle.somnia.host/v1/graphql` (value of `SOMNIA_TESTNET_PRICE_FEED.url`, `probe2.log`). Verified (`probe4.log`):
- Feed symbols are pairs: `BTC/USDC`, `ETH/USDC` (also `BTC/USDT`, `ETH/USDT` and ~27 others). The SDK's `fetchPrice("BTC")` resolves to the USDC pair because `SOMNIA_TESTNET_PRICE_FEED.quote = "USDC"`.
- `Candle` rows (`resolution: "M1"`, fields `bucketStart, open, high, low, close, markClose, count`) exist: 61 M1 candles inside a 3600s window; oldest BTC/USDC M1 candle at `1784644260` (2026-07-21).
- `PricePoint` rows (`blockTimestamp, spot, mark`, 18 decimals) exist at roughly one tick per second: 1,000 points covered `1788447600`→`1788448642` (17 minutes). Oldest BTC/USDC point `1784644290`, newest within seconds of now.
- Consistency check: opening answer 2489.37 at `1788447602`; feed M1 open 2489.325 at `1788447600`. Same source, 2-second offset.
- Client methods `fetchPriceHistory(asset, {from, to, limit})` and `fetchPriceCandles(asset, "M1", {from, to, limit})` wrap this (`somniaMarketsClient.d.ts:476-494`). Mainnet has no bundled feed constant (`ec-core/src/config.ts:resolvePriceFeed`); mainnet backtests would need `PRICE_FEED_URL` supplied.

This changes an earlier assumption: the Momentum template IS honestly backtestable, using the same feed the oracle settles on.

### 2.5 Bot Kit `ec-core` (verified from cloned source)

- Not published to npm (`npm view @dreamdex-bot-kit/ec-core` → 404). Package is `private: true`, `main: ./src/index.ts` (TypeScript source, runs via `tsx`). Dependencies: `@somnia-chain/markets-sdk ^0.28.1`, `dotenv`, `viem`. License MIT. **We vendor it** into `packages/ec-core`.
- Exports (`src/index.ts`): `createExchange, shutdown, assertTxOk, loadConfig, envNum, loadEnv, makeChain, DEPLOYMENTS, activeMarkets, marketOnchain, inVenue, resolveVenue, venueOf, operatorOf, outcomeSymbols, isTradable, snapshot, settledMarkets, explainEmptyScope, toRawUnits, quantize, MARKET_STATUS, seedInventory, placeLimit, cancelTracked, cancelVenueOrders, netPosition, untrackOrder, sellableSize, cancelById, headroomSec, minLeftSec, assertProbability, clampProbability, assertTradable, assertInventoryForSell, noPrice, estimatePayout` and claim helpers.
- `placeLimit(ctx, {market, onchain, outcome: "YES"|"NO", side, size, price, type?: "post-only"|..., expiresInSec?})` snaps size down to lot, price to tick, converts NO prices as `one - priceYes` in integers, and caps expiry at market expiry (`src/orders.ts:921-946`).
- Config defaults (`src/config.ts:197-203`): testnet `tick=1000, lot=1` (**lot disagrees with on-chain `lotSize=1000`**; we will read `getBinaryBookParams` at startup and override `MM_LOT`), mainnet `tick=lot=1e15`, `DRY_RUN` defaults to true, faucet auto-enabled on testnet.
- Env read by `loadConfig`: `NETWORK|DEPLOY_ENV`, `PRIVATE_KEY|TAKER_PRIVATE_KEY`, `VENUE_ID`, `OPERATOR_ID`, `RPC_URL`, `WS_RPC_URL`, `INDEXER_URL`, `CHAIN_ID`, `DECIMALS`, `MM_TICK`, `MM_LOT`, `MM_INVENTORY`, `MM_MAX_MARKETS`, `FAUCET_ENABLED`, `DRY_RUN`, `PRICE_FEED_URL`, `PRICE_FEED_QUOTE`, plus per-address overrides.

### 2.6 Hackathon template (verified from cloned source)

`typescript/src/{client,discover,lifecycle,redeem}.mjs`, run with `tsx`. Discovery scans `MarketCreated` logs (ABI deep-imported from `dist/eventsAbi.js`) in 1000-block windows and filters by collateral. Lifecycle: `mintSet` 4 contracts, `placeOrder` PostOnly SELL_YES, `placeOrder` IOC BUY_YES, `cancelOrder`, save `market.json`. Redeem: poll `getMarketOnchain` until `finalized || isResolved || isVoided`, then `trader.redeem({marketId, outcomeIdx, amount})`. Solidity interface file confirms `placeBinaryOrder(kind, price, quantity, expireTimestampNs, orderType, selfMatchingOption, builder, builderFeeBpsTimes1k, userData)` and revert selector `0xd3dea628` for bad expiry.

README suggested directions include "analytics", "market-making bot", "alerting on mispriced windows", "a sharpest traders tracker". README contains no judging criteria, deadline, or prize information.

---

## 3. Corrections to the pitch document

| Pitch said | Verified reality | Effect |
|---|---|---|
| Momentum vs strike uses `strike` | `strike` is 0 on the DreamDEX venue; opening price comes from `getOpeningPrices` / `openingAnswer`. Venue 0x1a1e carries `strike`. | Template renamed "Momentum vs opening price"; reference = opening answer, fallback `strike` when non-zero. |
| Intra-window spot unavailable, so momentum is weakly testable | Oracle price feed has tick-level and M1 history since 2026-07-21. | Momentum template is fully backtestable. |
| `createClient` | Not exported. Use `new SomniaMarkets()`. | Code change only. |
| ec-core via Bot Kit dependency | Not on npm. | Vendored copy in `packages/ec-core`. |
| 60s windows give thousands of traded samples | 60s windows are ~8% traded on testnet. 300s/900s/3600s are ~95–100% traded. | Demo series is BTC 300s. Bin counts shown everywhere. |
| Sixteen recipes as documented | `fetchOrderBook(marketId)` throws unless `loadMarkets()` ran first. Use `client.getBinaryOrderBook(pool)` (chain read) in the runner. | Runner reads the book from chain. |

---

## 4. Not verified, and how each will be closed

| Item | Why unverified | Closing step |
|---|---|---|
| `trader.faucet()` mints tUSDC | Needs an STT-funded key for gas; none available in this session. | Step 6: get STT from the Telegram faucet, run `scripts/verify/faucet.mjs`, record hash. |
| `mintSet` → `placeOrder` → `redeem` end to end from our code | Same reason. | Step 6, on a 300s window, record hashes. |
| Historical book state (bid/ask at time T) | Indexer stores orders with placed/updated timestamps, not book snapshots. Reconstruction from `Order` rows is approximate for partially-filled orders. | Step 2 uses last-trade price as the primary signal (exact). Step 8 adds reconstruction as an enhancement and labels it. Runner logs live book snapshots from day one so future windows have exact data. |
| Which testnet venue the DreamDEX web app itself uses | Not observable from the API. | Ask in the hackathon Telegram; default to 0x6797 per Bot Kit. |
| Judging criteria and deadline | Not in any source read. | Ask organizers. Plan assumes a 4-day build. |
| `node:sqlite` availability on Node 24.19 | Verified after the plan was drafted: `DatabaseSync` works (insert + select in memory). No fallback needed. | Closed. |

---

## 5. Architecture

```
build/
  PLAN.md
  package.json                 npm workspaces: apps/*, services/*, packages/*
  .env.example
  packages/
    ec-core/                   vendored from dreamdex-bot-kit (MIT), unchanged except imports
    shared/                    types, unit helpers (oracle 2-dp, 6/18-dp collateral), venue table
  services/
    data/                      sync CLI: indexer + price feed -> SQLite; calibration + features
    backtest/                  pure library: replay settled windows, templates, metrics; CLI
    runner/                    long-lived process: one strategy, one key, ec-core writes, JSONL log
  apps/
    web/                       Next.js: strategy picker, sliders, calibration chart, backtest
                               results, burner wallet, deploy, live panel. Route handlers read
                               SQLite, run backtests, spawn/stop runner processes.
  scripts/verify/              the probes that produced docs/verification/*.log
  docs/verification/           evidence logs
```

Runtime: Node 24, TypeScript, `tsx` for services, npm workspaces. UI: Next.js App Router + React, charts as inline SVG (no chart library needed for a line, a scatter and an equity curve). SQLite via `node:sqlite` (fallback `better-sqlite3`).

### 5.1 Data service (`services/data`)

Tables:

```
markets(marketId PK, network, venueId, operatorId, asset, intervalSec, poolAddress, nonce,
        tradingStart, expiry, status, winningOutcome, voided, finalized, tradeCount,
        quoteVolumeRaw, baseVolumeRaw, quoteDecimals, strikeRaw, openingAnswerRaw,
        closingAnswerRaw, resolvedAt, syncedAt)
fills(id PK, marketId, pool, ts, fillPriceRaw, quantityRaw, kind, makerSide, takerSide)
orders(orderId PK, marketId, owner, isBid, side, priceRaw, fullQtyRaw, filledQtyRaw,
       status, placedAt, updatedAt, expireNs)
price_points(symbol, ts, spotRaw, markRaw, PK(symbol, ts))
window_features(marketId PK, lastTradeProbAtT30, lastTradeProbAtT60, lastTradeProbAtT120,
                firstTradeProb, vwapProb, nTrades, openRef, closeRef, moveBpsAtT30,
                moveBpsAtT60, moveBpsAtT120)
calibration(network, venueId, asset, intervalSec, tSec, bin, n, upWins, PK(...))
```

Sync loop (`npm run sync -w services/data`):
1. `listPastBinaryMarkets({venueId, asset, intervalSec, status: "Finalized", limit: 200, offset})` page until a page returns only known ids. Store every row field listed in §2.1.
2. For each new market with `tradeCount > 0`: `getFills(pool, {since: tradingStart, until: expiry, limit: 1000})`, raw GraphQL `Order` by `market_id`, `getMarketResolution`, and batch `getOpeningPrices`.
3. For each `(asset, tradingStart, expiry)`: raw GraphQL `PricePoint` for `${asset}/USDC` in `[tradingStart - 60, expiry + 5]`, paged by `blockTimestamp` (limit 1000 per page, verified page size).
4. Compute `window_features` and rebuild `calibration` per `(series, tSec ∈ {30, 60, 120}, bin ∈ 20 bins)`.

Units: fill prices are YES probability × 10^quoteDecimals. Oracle answers are 2-dp fixed. Price feed is 18-dp. All conversions live in `packages/shared/units.ts` with unit tests against the values in the logs (`520000` → 0.52 at 6 dp; `248937` → 2489.37; `2489325000000000000000` → 2489.325).

### 5.2 Backtest library (`services/backtest`)

Input: a series filter, a template id, parameters, a date range. Output: per-window decisions and a summary.

Common rules, applied identically to every template:
- A window is eligible only if it has `winningOutcome` or `voided`, `tradingStart` and `expiry`, and at least one fill (fill-free windows cannot support a fill-price estimate and are reported as "skipped: no prints").
- Decision time `T` = `expiry - seconds_left`. The strategy sees only data with `ts <= T`.
- Fill model for a taker buy at time `T`: pay the **last printed YES price at or before `T`** plus `slippage_ticks × tick` (parameter, default 2 ticks = 0.002), capped by `max_price`. If the last print is older than `stale_sec` (default 60s for 300s windows) the window is skipped as "no fresh print". This is labelled in the UI as an estimate, and the exact reconstruction (from `orders`) is listed as the Step 8 enhancement.
- Payout: resolved → 1.0 per winning contract, 0 otherwise; voided → 0.5 per contract each side.
- Fees: zero on DreamDEX (`getMarketFees` returns venue fees; the plan verifies they are 0 in Step 2 and stores the value).
- Metrics: trades, hit rate, mean PnL per contract, total PnL, max drawdown, sample size, and the Wilson 95% interval on hit rate.

Templates:
1. **Momentum vs opening price.** Reference = `openingAnswerRaw` (fallback `strikeRaw` if non-zero, else skip). At `T`, spot = last `price_points` at or before `T`. `moveBps = (spot - ref) / ref × 1e4`. If `moveBps ≥ +move_bps` buy UP; if `≤ -move_bps` buy DOWN; else no trade. Params: `move_bps`, `seconds_left`, `max_price`, `size`.
2. **Late-window mispricing.** At `T`, `p = lastTradeProb(T)`. Look up calibration `(series, seconds_left, bin(p))` computed on windows *before* the current one's date range (walk-forward, no leakage). If `realized - p ≥ edge` buy UP; if `p - realized ≥ edge` buy DOWN. Params: `edge`, `seconds_left`, `min_bin_n`, `max_price`, `size`.
3. **Probability ladder.** Rest bids at `low_price … high_price` in `rungs` steps at `tradingStart + delay`. A rung is considered filled only if a later print traded **at or below** its price (conservative). Held to settlement. Params: `low_price`, `high_price`, `rungs`, `size_per_rung`, `delay_sec`. UI labels this "fill estimated from prints; resting-fill timing is not simulated".

### 5.3 Runner (`services/runner`)

One process per deployed strategy. Reads a JSON strategy spec and env. Loop every `TICK_MS` (default 5000):
1. `listLiveBinaryMarkets({venueId, asset, intervalSec, limit: 10})`, then gate each with `client.getMarketOnchain(marketId).status === 1` and `expiry - now ≥ headroom`.
2. Read book from chain: `client.getBinaryOrderBook(pool, {depth: 5})`. Log a snapshot row (`book_snapshots`) every tick — this builds the exact historical book for future backtests.
3. Read spot: `exchange.fetchPrice(asset)`.
4. Evaluate the template (same code as the backtester, imported from `services/backtest`).
5. Place via vendored `placeLimit` with `type: "ioc"` for taker templates, `post-only` for the ladder. Wrap every write in `assertTxOk`.
6. Every `CLAIM_INTERVAL_MS`: `settledMarkets()` → for each with balance, `trader.redeem`. Same loop, same key, serialized (nonce safety per bot-kit test report).
7. Emit JSONL events (`decision`, `order`, `fill`, `claim`, `error`) to stdout; the web app tails them.

Startup validation: read `getBinaryBookParams(pool)` for the first live pool and set `MM_TICK`/`MM_LOT` from chain, never from defaults.

### 5.4 Web app (`apps/web`)

Pages:
- `/` Calibration map for a chosen series (asset × interval × venue), bins with counts, diagonal, and the traded-window rate.
- `/backtest` Template picker, parameter sliders, run button, equity curve, hit rate with interval, decision table, "skipped" breakdown.
- `/deploy` Burner wallet: generate key in browser (`viem/accounts` `generatePrivateKey`), show address, "Fund tUSDC" button (calls `trader.faucet()` via a route handler that receives the key once and starts the runner), STT instructions with the Telegram link, start/stop.
- `/live/[id]` Runner event stream, live PnL, backtest projection overlay.
- `/export` Renders a `.env` for `ec-oracle-follow` or `ec-laddering-bot` with tuned values.

Route handlers: `GET /api/calibration`, `POST /api/backtest`, `POST /api/runners`, `DELETE /api/runners/:id`, `GET /api/runners/:id/events` (SSE).

Key handling: the burner key is generated client-side, posted once over localhost/HTTPS to start the runner, kept only in that child process's env, never written to disk. Testnet only, enforced in the route handler by refusing `NETWORK=mainnet`.

---

## 6. Execution steps

Each step ends with a verification command whose output goes into `docs/verification/`.

| # | Step | Done when |
|---|---|---|
| 0 | Workspace: `package.json` workspaces, `tsconfig.base.json`, `.env.example`, check `node:sqlite`. Vendor `ec-core` from the cloned Bot Kit into `packages/ec-core`; `tsc --noEmit` passes. | `npm install` clean; `npx tsc -p packages/ec-core` exits 0; `node -e "require('node:sqlite')"` result recorded. |
| 1 | `packages/shared`: unit conversions + venue table + types. Unit tests against logged values. | `npm test -w packages/shared` green. |
| 2 | `services/data` sync: markets, fills, orders, resolutions, opening prices, price points for testnet BTC/ETH 300s/900s/3600s on venue 0x6797 (last 30 days). Record `getMarketFees` for the venue. | `sqlite3 data.db "select count(*) from markets"` ≥ 2,000; a spot-check script prints one window's fills, opening/closing answers and outcome side by side, matching `indexerprobe.log`. |
| 3 | Calibration computation + `/` page with the real curve and bin counts. | Page renders BTC 300s from the DB; numbers reproduce from a standalone SQL query. |
| 4 | Backtest library: eligibility, fill model, payout, metrics, Momentum and Late-window templates, CLI. | Hand-check ten windows: CLI output equals a spreadsheet computed from the same DB rows. Walk-forward test: calibration used for window W contains no window ≥ W. |
| 5 | `/backtest` page with sliders, equity curve, decision table. | Changing `seconds_left` re-runs in < 3 s on 2,000 windows. |
| 6 | Testnet write path (needs STT from Telegram faucet): `scripts/verify/faucet.mjs`, then a single IOC buy on a live 300s window with `placeLimit`, then `redeem` after expiry. | Three tx hashes recorded in `docs/verification/writes.log`, receipts `status: "success"`. |
| 7 | Runner: loop, gating, chain book read + snapshot logging, template evaluation, `assertTxOk`, claims, JSONL. `/deploy` and `/live` pages. | A strategy started from the UI places a real testnet order and its fill appears on `/live` within one window. Stop leaves zero open orders (`getAllOpenOrdersOnchain` both sides empty for our address). |
| 8 | Ladder template; `/export`; book reconstruction from `orders` as an optional fill model with an accuracy comparison against runner snapshots. | Export file runs under the Bot Kit in `DRY_RUN=true`. Comparison table in `docs/verification/book-reconstruction.md`. |
| 9 | Demo rehearsal: script in `docs/demo.md`, under four minutes, with a fallback recording. | Two clean dry runs. |

Order is strict through step 4; steps 5–8 can interleave; step 6 is the first moment a funded key is required.

---

## 7. Environment

```
NETWORK=testnet                       # runner refuses mainnet
VENUE_ID=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c
INDEXER_URL=https://dev.smk.somnia.host/v1/graphql
WS_RPC_URL=wss://api.infra.testnet.somnia.network/ws
RPC_URL=https://api.infra.testnet.somnia.network
PRICE_FEED_URL=https://price-feed.dev.oracle.somnia.host/v1/graphql
PRICE_FEED_QUOTE=USDC
DATA_DB=./data/calibrate.sqlite
# PRIVATE_KEY is never set in .env for the web app; runners receive it in their own env at spawn.
```

---

## 8. Risks

- **Indexer changes.** The Bot Kit report notes SDK 0.23.0 broke against deployed indexers once. Pin `0.28.1`, and keep the raw GraphQL queries in one file so a schema change is a one-file fix.
- **Order book reconstruction is approximate.** Primary signal is last print, which is exact. Reconstruction is an add-on and labelled.
- **Thin mainnet history.** Mainnet is export-only; no mainnet backtests are shown unless the series has ≥ 200 traded windows.
- **Nonce collisions.** One key per runner; writes and claims serialized in one loop.
- **Public-role caps.** Counts cap at 10,000 and aggregates are hidden. Everything is paged with `limit`/`offset` and counted locally.
- **Faucet may be rate-limited or disabled.** Step 6 verifies. Fallback: Telegram faucet only, with the UI showing a "fund this address" panel.
