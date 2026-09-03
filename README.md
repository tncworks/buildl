# Calibrate

Find the edge in settled DreamDEX Event Contract windows, backtest it against real fills and oracle prices, and run it live on Somnia testnet from a burner wallet. No code.

- `PLAN.md` — the verified execution plan.
- `docs/README.md` — index of step records, evidence logs and screenshots.

## Layout

```
packages/shared     units, networks, venues, row types
packages/ec-core    vendored from somnia-chain/dreamdex-bot-kit (MIT)
services/data       sync CLI → SQLite; window features; calibration; book reconstruction
services/backtest   templates, engine, metrics, CLI, hand-check
services/runner     live strategy process (testnet only)
apps/web            Next.js 16 + Tailwind v4: map, backtest, deploy, live, export
scripts/verify      rerunnable probes and on-chain verification scripts
docs                step records, verification logs, screenshots, demo script
```

## Run

```
cp .env.example .env
npm install
npm approve-scripts --allow-scripts-pending && npm rebuild esbuild   # esbuild postinstall gate on this machine
npm run sync -- --days 5 --assets BTC,ETH --intervals 300,900,3600     # first run ~40 min
npm run web -- --port 3210
```

Useful commands:

```
npm test                                   # all unit tests
npm run typecheck                          # every workspace
npm run stats -- BTC 300                   # DB coverage + calibration table
npm run spotcheck                          # one window vs a fresh indexer read
npm run backtest -- --asset BTC --interval 300 --template momentum --params '{"move_bps":3}' --rows 10
npx tsx services/backtest/src/handcheck.ts --n 10
npx tsx services/data/src/verify-calibration.ts BTC 300 60
npx tsx services/data/src/compare-book.ts
```
