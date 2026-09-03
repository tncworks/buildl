# Step 1 — Shared package

Date: 2026-09-04

## What was done

`packages/shared` holds everything more than one service needs and nothing that touches the network:

- `src/units.ts` — conversions between the three numeric scales the system meets, each pinned to a value observed live (see comments in the file and `docs/verification/*.log`):
  - book/fill prices: YES probability × 10^quoteDecimals (6 on testnet, 18 on mainnet)
  - oracle answers and `strike`: 2-decimal fixed point (`248937` = 2489.37)
  - price-feed ticks and candles: 18 decimals
  - plus grid snapping (`probToPriceRaw` rounds to tick in integer arithmetic; `sizeToQuantityRaw` floors to lot), `moveBps`, `secToNs`.
- `src/venues.ts` — networks (chain ids, RPC/WS/indexer/price-feed URLs, collateral, on-chain tick/lot/minQty) and the three venues seen live, with how each carries its reference price (`openingAnswer` on the DreamDEX venues, `strike` on the price-feed test venue).
- `src/types.ts` — row shapes for the SQLite tables.

## Verification

```
$ npm run typecheck -w @calibrate/shared     # exit 0
$ npm test -w @calibrate/shared
 ✓ tests/units.test.ts (15 tests)
```

Each unit test asserts a value taken from a verification log, e.g. `priceRawToProb("520000", 6) === 0.52` (indexerprobe.log candle open), `oracleRawToNumber("248937") === 2489.37` (probe2.log opening answer), `feedRawToNumber("2489325000000000000000") === 2489.325` (probe4.log M1 candle open), and the 18-decimal grid snap of 0.05 that the SDK's own docs describe as the float-drift gotcha.

## Notes

- Relative imports inside workspace packages are extensionless (`./units`, not `./units.js`). Turbopack in Next 16 does not map `.js` specifiers onto `.ts` sources for `transpilePackages`; tsc (Bundler resolution), tsx and vitest all accept the extensionless form. Applied to `packages/shared`, `services/data`, `services/backtest`. The vendored `ec-core` keeps upstream's `.js` imports; it is only ever run under `tsx`, never bundled.
