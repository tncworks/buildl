// Record the venue fee config the indexer reports for a recent finalized market (plan §5.2 assumes zero fees).
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
const ex = new SomniaMarkets({ indexerUrl: "https://dev.smk.somnia.host/v1/graphql", chain: somniaShannon, wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws", addresses: SOMNIA_TESTNET_ADDRESSES });
const venueId = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
const rows = await ex.client.listPastBinaryMarkets({ venueId, asset: "BTC", intervalSec: 300, status: "Finalized", limit: 2 });
for (const r of rows) console.log(r.marketId, JSON.stringify(await ex.client.getMarketFees(r.marketId)));
process.exit(0);
