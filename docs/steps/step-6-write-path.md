# Step 6 — Testnet write path

Status: waiting on STT gas. Everything below is prepared; nothing has been sent on chain yet.

## Burner

A testnet burner key was generated with `viem/accounts.generatePrivateKey` on 2026-09-04 and written to `build/.env` as `PRIVATE_KEY` (gitignored). Its address is in `docs/verification/burner-address.txt`:

```
0x889AD6CC21b22586E144ac1bc8CfFb088C34Fe3F
```

To unblock this step, post that address in the faucet topic of the SomniaHacks dev group (https://t.me/+XHq0F0JXMyhmMzM0) and wait for STT to arrive. `curl "http://localhost:3210/api/wallet?address=0x889AD6CC21b22586E144ac1bc8CfFb088C34Fe3F"` shows the balance.

## Scripts (in order)

1. `node scripts/verify/faucet.mjs` — calls `trader.faucet({amount: 1000 tUSDC})`, prints balances before and after, exits non-zero on a reverted receipt. Closes the "does the faucet actually mint" unknown from PLAN.md §4.
2. `node scripts/verify/write-path.mjs --size 1` — picks the soonest live BTC/300s window with more than 60 s left, reads the YES book from chain, crosses the best ask with a 1-contract IOC through ec-core `placeLimit`, prints the receipt, waits for resolution, and calls `trader.redeem` for the YES position (a losing position redeems for 0; the call is made regardless to record the behaviour). `--no-wait` skips the redeem.
3. Record the three transaction hashes and receipt statuses here and in `docs/verification/writes.log`.

## Expected on-chain behaviour (from the SDK and docs, not yet observed here)

- `faucet(uint256)` exists in the tUSDC bytecode (selector verified in `chainprobe.log`); the SDK caps its default at 10,000 tUSDC per call.
- `placeOrder` with `orderType 2` (IOC) fills what crosses and cancels the rest; the receipt's `fills[]` carry `quantityFilled` and `fillPrice`.
- `redeem` routes through the BinaryMarketsModule and pays 1 collateral per winning contract (settlement fee is zero on DreamDEX).
