# Demo script (target: under four minutes)

Preconditions: `npm run sync -- --days 1` ran within the last hour (fresh windows), the web app is up on port 3210, the burner in `.env` holds STT and tUSDC, and one runner was started five minutes before going on stage so a fill is already on `/live`.

1. **Map (40 s).** Open `/`. "Every dot is hundreds of settled five-minute BTC windows. X is what the book paid for Up with sixty seconds left; Y is how often Up actually won. Dots on the diagonal are fairly priced. This one is not." Point at the largest edge tile. Switch to T−30s: the curve tightens toward the diagonal as expiry approaches.
2. **Backtest (60 s).** Click "Backtest this edge". Show trades, hit rate with its confidence interval, the equity curve. Drag `seconds_left`; the run re-executes in tens of milliseconds. Flip the fill model from "last print" to "reconstructed book": PnL drops. "The honest number is the lower one. Prints are where the last trade happened; the book is what you would actually pay."
3. **Momentum (30 s).** Switch template to Momentum vs opening price. "Same feed the oracle settles on, tick by tick, so this backtest is not guessing the spot."
4. **Deploy (40 s).** Open `/deploy`. Burner address, balances, one click to mint tUSDC from the faucet, start live. "The key was generated in this tab. The server sees it once, hands it to one process, and forgets it. Mainnet is refused."
5. **Live (40 s).** Open the runner started before the talk. Decision events, the order, the fill hash, realized PnL beside the backtest projection for the same parameters. "Estimated versus real, side by side."
6. **Export (20 s).** "For mainnet you run it yourself." Show the generated Bot Kit `.env` and the mapping table, including what is not mapped.

Fallback: if the testnet is unhealthy, the dry-run runner still streams decisions and book snapshots; say so on stage rather than hiding it.
