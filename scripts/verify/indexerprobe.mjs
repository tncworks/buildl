import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, SOMNIA_MAINNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import * as chains from "@somnia-chain/markets-sdk/chains";
const nets = [
  { name: "testnet", indexerUrl: "https://dev.smk.somnia.host/v1/graphql", ws: "wss://api.infra.testnet.somnia.network/ws", chainId: 50312 },
  { name: "mainnet", indexerUrl: "https://prd.smk.somnia.host/v1/graphql", ws: "wss://api.infra.mainnet.somnia.network/ws", chainId: 5031 },
];
console.log("chains exports:", Object.keys(chains));
const chainFor = (id) => Object.values(chains).find((c) => c && typeof c === "object" && c.id === id);
for (const n of nets) {
  console.log(`\n=========== ${n.name}`);
  try {
    const ex = new SomniaMarkets({ indexerUrl: n.indexerUrl, chain: chainFor(n.chainId), wsRpcUrl: n.ws, addresses: n.name === "testnet" ? SOMNIA_TESTNET_ADDRESSES : SOMNIA_MAINNET_ADDRESSES }); const client = ex.client;
    const venues = await client.listBinaryVenueIds();
    console.log("venues:", JSON.stringify(venues));
    const assets = await client.listBinaryAssets();
    console.log("assets:", JSON.stringify(assets));
    const nowSec = Math.floor(Date.now() / 1000);
    for (const asset of assets.slice(0, 4)) {
      const live = await client.countBinaryMarkets({ asset, phase: "live", nowSec });
      const past = await client.countBinaryMarkets({ asset, phase: "past", nowSec });
      const fin = await client.countBinaryMarkets({ asset, phase: "past", status: "Finalized", nowSec });
      console.log(`count ${asset}: live=${live} past=${past} pastFinalized=${fin}`);
    }
    const rows = await client.listPastBinaryMarkets({ status: "Finalized", limit: 400 });
    console.log(`listPastBinaryMarkets Finalized: ${rows.length} rows`);
    const byKey = {};
    for (const r of rows) { const k = `${r.asset}/${r.intervalSec}s`; byKey[k] = byKey[k] || { n: 0, traded: 0, trades: 0 }; byKey[k].n++; if (Number(r.tradeCount) > 0) { byKey[k].traded++; byKey[k].trades += Number(r.tradeCount); } }
    console.log("by asset/interval (n, withTrades, totalTrades):", JSON.stringify(byKey));
    const sample = rows.filter((r) => Number(r.tradeCount) > 0).sort((a, b) => Number(b.tradeCount) - Number(a.tradeCount))[0];
    if (sample) {
      const keep = ["id","marketId","poolAddress","asset","intervalSec","strike","tradingStart","expiry","status","winningOutcome","voided","finalized","tradeCount","cumulativeQuoteVolume","cumulativeBaseVolume","lastPrice","quoteDecimals","baseDecimals","venueId","operatorId","nonce","oracleQuestionId","payoutNumerators"];
      console.log("sample row:", JSON.stringify(Object.fromEntries(keep.map((k) => [k, sample[k]]))));
      const candles = await client.getCandles(sample.poolAddress, 60, { from: Number(sample.tradingStart), to: Number(sample.expiry), limit: 500 });
      console.log(`candles(60s) in window: ${candles.length}; first=${JSON.stringify(candles[0])}`);
      const fills = await client.getFills(sample.poolAddress, { since: Number(sample.tradingStart), until: Number(sample.expiry), limit: 500 });
      console.log(`fills in window: ${fills.length}; first=${JSON.stringify(fills[0])}`);
      console.log("fills market ids match:", fills.every((f) => f.market.toLowerCase() === sample.marketId.toLowerCase()));
      const res = await client.getMarketResolution(sample.marketId);
      console.log("getMarketResolution:", JSON.stringify(res).slice(0, 600));
      const open = await client.getOpeningPrices([sample.marketId]);
      console.log("getOpeningPrices:", JSON.stringify(open));
      const oc = await client.getMarketOnchain(sample.marketId);
      const bp = await client.getBinaryBookParams(sample.poolAddress); console.log("getBinaryBookParams:", JSON.stringify(bp, (k,v)=>typeof v==="bigint"?v.toString():v));
      console.log("getMarketOnchain:", JSON.stringify(oc, (k, v) => typeof v === "bigint" ? v.toString() : v).slice(0, 700));
    }
    const liveRows = await client.listLiveBinaryMarkets({ limit: 10 });
    console.log(`live markets: ${liveRows.length}`, liveRows.slice(0, 5).map((r) => `${r.asset}/${r.intervalSec}s status=${r.status} exp=${r.expiry} venue=${r.venueId}`));
  } catch (e) { console.log("FAILED:", e.shortMessage || e.message, (e.stack || "").split("\n").slice(1, 3).join(" | ")); }
}
process.exit(0);
