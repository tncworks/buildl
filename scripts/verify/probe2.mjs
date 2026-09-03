import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const J = (o) => JSON.stringify(o, (k, v) => typeof v === "bigint" ? v.toString() : v);
console.log("SOMNIA_TESTNET_PRICE_FEED:", J(SOMNIA_TESTNET_PRICE_FEED));
const ex = new SomniaMarkets({ indexerUrl: "https://dev.smk.somnia.host/v1/graphql", chain: somniaShannon, wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws", addresses: SOMNIA_TESTNET_ADDRESSES, priceFeed: SOMNIA_TESTNET_PRICE_FEED });
const c = ex.client;
const id = "0x0000000000000000000000000000000000000000000000000000000000012563";
const res = await c.getMarketResolution(id);
console.log("resolution full:", J(res));
const hist = await c.getMarketStatusHistory(id);
console.log("status history:", J(hist));
// a 300s market on venue 0x6797 with trades
const rows = await c.listPastBinaryMarkets({ status: "Finalized", asset: "BTC", intervalSec: 300, limit: 5 });
console.log("BTC/300s recent:", rows.map((r) => `${r.marketId.slice(-6)} trades=${r.tradeCount} strike=${r.strike} venue=${r.venueId?.slice(0, 10)} q=${r.question}`));
const open = await c.getOpeningPrices(rows.map((r) => r.marketId));
console.log("opening prices:", J(open));
const r0 = rows[0];
const res0 = await c.getMarketResolution(r0.marketId);
console.log("300s closingAnswer:", J(res0.closingAnswer), "openingAnswer:", J(res0.openingAnswer), "oracleAnswer:", J(res0.oracleAnswer));
// price feed
for (const m of ["fetchPrice", "watchPrice", "fetchPriceCandles", "fetchPriceHistory"]) console.log(`exchange.${m}:`, typeof ex[m]);
try { const p = await ex.fetchPrice("BTC"); console.log("fetchPrice(BTC):", J(p)); } catch (e) { console.log("fetchPrice failed:", e.message.split("\n")[0]); }
for (const path of ["", "/candles?symbol=BTC&resolution=60", "/history?symbol=BTC", "/prices", "/BTC"]) {
  try { const r = await fetch(SOMNIA_TESTNET_PRICE_FEED.url + path); const t = await r.text(); console.log(`GET ${SOMNIA_TESTNET_PRICE_FEED.url + path} -> ${r.status} ${t.slice(0, 200).replace(/\n/g, " ")}`); } catch (e) { console.log("GET failed", path, e.message); }
}
// live book on a trading market
const live = await c.listLiveBinaryMarkets({ limit: 20 });
const t = live.find((m) => Number(m.intervalSec) === 300 && m.asset === "BTC");
if (t) {
  console.log("live BTC/300s:", t.marketId, "venue", t.venueId, "pool", t.poolAddress);
  const bids = await c.getAllOpenOrdersOnchain(t.poolAddress, { isBid: true });
  const asks = await c.getAllOpenOrdersOnchain(t.poolAddress, { isBid: false });
  console.log("onchain open orders: bids", J(bids).slice(0, 400), "\nasks", J(asks).slice(0, 400));
  for (const m of ["getBinaryOrderBook", "getLiveBinaryOrderBook", "watchMarket", "getOrders", "getUserOrders", "listOrders", "getOrderHistory"]) console.log(`client.${m}:`, typeof c[m]);
  try { const ob = await ex.fetchOrderBook(t.marketId, 5); console.log("fetchOrderBook(marketId):", J(ob).slice(0, 400)); } catch (e) { console.log("fetchOrderBook(marketId) failed:", e.message.split("\n")[0]); }
}
process.exit(0);
