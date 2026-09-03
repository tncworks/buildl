// Step 6a: call the tUSDC faucet with the key in .env and record the receipt.
//   node scripts/verify/faucet.mjs
// Needs STT for gas on the key's address (Telegram faucet: https://t.me/+XHq0F0JXMyhmMzM0).
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url) });

const pk = process.env.PRIVATE_KEY;
if (!pk || pk === "0x...") throw new Error("PRIVATE_KEY not set in build/.env");
const me = privateKeyToAccount(pk).address;
const pub = createPublicClient({ chain: somniaShannon, transport: http("https://api.infra.testnet.somnia.network") });
const tusdc = SOMNIA_TESTNET_ADDRESSES.testUsdc;
const bal = async () => ({ stt: formatUnits(await pub.getBalance({ address: me }), 18), tusdc: formatUnits(await pub.readContract({ address: tusdc, abi: erc20Abi, functionName: "balanceOf", args: [me] }), 6) });
console.log("address", me, "before", await bal());
const ex = new SomniaMarkets({ indexerUrl: "https://dev.smk.somnia.host/v1/graphql", chain: somniaShannon, wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws", addresses: SOMNIA_TESTNET_ADDRESSES, privateKey: pk });
const res = await ex.trader.faucet({ amount: 1000n * 1_000_000n });
console.log("faucet tx", res.hash, "status", res.receipt.status, "gasUsed", res.receipt.gasUsed.toString());
console.log("after", await bal());
process.exit(res.receipt.status === "success" ? 0 : 1);
