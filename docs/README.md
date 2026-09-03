# Calibrate — documentation index

- `../PLAN.md` — the execution plan, with every fact tagged by how it was verified.
- `steps/` — one record per plan step: what was built, the exact verification commands, their output, and any corrections to the plan.
- `verification/` — raw evidence: probe outputs from the planning phase, sync logs, runner dry-run event logs, Bot Kit dry-run logs, book-reconstruction comparison, rehearsal timings.
- `screenshots/` — the four pages as rendered by headless Chromium against real data.
- `demo.md` — the stage script.
- `../scripts/verify/` — the scripts that produced the evidence; each is rerunnable with `node` or `npx tsx`.

| Step | Record | Gate | Status |
|---|---|---|---|
| 0 | steps/step-0-workspace.md | install, typecheck, vendored ec-core tests | done |
| 1 | steps/step-1-shared.md | 15 unit tests pinned to logged values | done |
| 2 | steps/step-2-data.md | ≥ 2,000 markets synced (3,920); spot-check matches indexer | done |
| 3 | steps/step-3-calibration.md | page renders real curve; raw-SQL reproduction matches on 4 series/times | done |
| 4 | steps/step-4-backtest.md | 8 unit tests; 10 + 8 trades hand-checked from raw SQL | done |
| 5 | steps/step-5-backtest-page.md | slider re-run ≈ 30–50 ms on 1,406 windows | done |
| 6 | steps/step-6-write-path.md | faucet, IOC buy, redeem receipts | **blocked: burner needs STT** (address in the record) |
| 7 | steps/step-7-runner.md | dry-run runner from UI streams decisions and stops clean; live fill | dry-run verified; live fill waits on step 6 |
| 8 | steps/step-8-ladder-export-book.md | export runs under Bot Kit dry run; book reconstruction vs snapshots (77–79 % exact) | done |
| 9 | steps/step-9-demo.md | two clean scripted rehearsals | done (spoken run with live fill waits on step 6) |

Running the app:

```
cd build
cp .env.example .env               # defaults are the verified testnet endpoints
npm install && npm approve-scripts --allow-scripts-pending && npm rebuild esbuild
npm run sync -- --days 5           # ~35 min the first time (orders are the bulk); add --skip-orders for ~10 min
npm run web -- --port 3210         # http://localhost:3210
```
