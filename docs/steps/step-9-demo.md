# Step 9 — Demo rehearsal

Date: 2026-09-04

## What was done

- `docs/demo.md` — the four-minute stage script: map → backtest this edge → fill-model flip → momentum → deploy → live → export, with the honest lines to say at each step and the fallback if the testnet is unhealthy.
- Two scripted rehearsals (`docs/verification/rehearsal.log`) walk the same route over HTTP: the map at two decision times, the deep-linked mispricing backtest, the momentum backtest, both fill models through the API, a dry-run runner started through the API, its live page, and a clean stop.

```
rehearsal 1: all pages 200 = 1, live runner 4079426533e9, elapsed 13.6 s
rehearsal 2: all pages 200 = 1, live runner ee8fdbaff1be, elapsed 12.6 s
```

Gate "two clean dry runs": passed for the scripted route. The spoken rehearsal with a live-fire runner (a real fill on `/live`) waits on step 6.

## What the demo cannot claim yet

- A real testnet fill on stage (step 6 blocked on STT gas).
- A robust exploitable edge from the calibration map: at 10–30 windows per bin the intervals are wide, and the walk-forward mispricing backtest is flat-to-negative on BTC/300s. The demo shows the method and its honesty, not a money machine. Say that.
