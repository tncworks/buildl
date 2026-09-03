# Step 4 — Backtest library

Date: 2026-09-04

## What was done

`services/backtest` is a pure library plus a CLI. It replays the settled windows of one series and applies one template per window.

Files:
- `src/types.ts` — template specs (parameters with ranges and help text), decision context, per-window result, summary.
- `src/templates.ts` — the three templates and their parameter specs. `decideMomentum` and `decideMispricing` are pure functions of a `DecisionContext`, so the runner (step 7) reuses them unchanged on live data.
- `src/engine.ts` — window loop, eligibility, fill model, payout, walk-forward calibration accumulator, ladder simulation.
- `src/metrics.ts` — summary (trades, hit rate with Wilson 95% interval, total and per-contract PnL, max drawdown, skip reasons, equity curve).
- `src/cli.ts` — `npm run backtest -- --asset BTC --interval 300 --template momentum --params '{...}' --rows N`.
- `src/handcheck.ts` — independent recomputation of the first N trades from raw SQL (the gate for this step).

## Rules the engine applies to every template

- Decision time `T = expiry − seconds_left`. Only fills with `ts ≤ T` and price ticks with `ts ≤ T` are visible.
- Taker fill price = last printed YES price at or before `T` (converted to the chosen side as `1 − p` for Down) + `slippage_ticks × 0.001`. A print older than `stale_sec` skips the window (`no-fresh-print`); a price above `max_price` skips it (`price-cap`). No print at all skips it (`no-prints`).
- Payout: 1 per contract if the side won, 0 if it lost, 0.5 if the window was voided.
- Fees: zero (DreamDEX sets maker, taker and settlement fees to zero; this is stated in the docs and `getMarketFees` is recorded by the sync).
- Mispricing calibration is walk-forward: a window's own outcome is added to the accumulator only after its decision is made, so no window ever sees itself or a later window.
- Ladder: a rung counts as filled only if a later print traded at or below its price. The UI labels this as an upper bound on fills.

## Verification

Unit tests (`npm test -w @calibrate/backtest`, 8 tests): template decisions in both directions and the no-signal band, calibration gating by `min_bin_n`, ladder rung spacing, Wilson interval against a known value (7/10 → 0.397..0.892), and an in-memory three-window series where every PnL is computed by hand in the test file (e.g. buy UP at 0.60 + 2 ticks, win → (1 − 0.602) × 5).

Hand-check on real data (`npx tsx services/backtest/src/handcheck.ts --asset BTC --interval 300 --template momentum --params '{"move_bps":2,"seconds_left":60}' --n 10`): for each of the first ten trades the script re-reads the market row, the last fill at or before `T`, the last price tick at or before `T`, and the outcome with plain SQL, recomputes the decision, fill, payout and PnL, and compares field by field.

```
0117a5 expiry=1788377400 T=1788377340 spot=77198.0725 open=77226.64 yesPrint=0.143@1788377317 → MATCH (side=DOWN price=0.859 outcome=DOWN pnl=0.705)
011a6f expiry=1788391800 T=1788391740 spot=77172.55   open=77139.91 yesPrint=0.893@1788391711 → MATCH (side=UP   price=0.895 outcome=UP   pnl=0.525)
… (8 more, all MATCH)
ALL 10 MATCH
```

Walk-forward test: in the unit suite, the first window of the mispricing run is skipped with `no-calibration`, and the second is skipped because the only earlier window fell in a different bucket. This is the "calibration used for window W contains no window ≥ W" check from the plan.

Speed: over 1,406 BTC/300s windows the momentum run took 31 ms inside the web route handler (see step 5); 46–55 ms after the tick backfill with 38 trades.

Final numbers after the tick backfill (all five days of spot covered): BTC/300s momentum `move_bps 2, seconds_left 60` → 38 trades, 34 wins, hit rate 0.895 (CI 0.759–0.958), PnL 32.64; ETH/300s same params → 30 trades, 27 wins, PnL 26.55; BTC/900s `move_bps 3` → 2 trades (most 900s windows have no fresh print at T−60). Re-running the hand-check on the refreshed DB: `ALL 10 MATCH`.

## Corrections to the plan

- The plan named the momentum reference "strike". On the DreamDEX venue `strike` is 0 and the reference is the opening oracle answer; `referencePrice()` in `services/data/src/features.ts` uses the opening answer first and falls back to a non-zero `strike`.
