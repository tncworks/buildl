import { NextResponse } from "next/server";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { NETWORKS } from "@calibrate/shared";

export const dynamic = "force-dynamic";

const net = NETWORKS.testnet;
const pub = createPublicClient({ chain: somniaShannon, transport: http(process.env.RPC_URL ?? net.rpcUrl) });

/** GET /api/wallet?address=0x… → STT and tUSDC balances (testnet). */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") as `0x${string}` | null;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "address required" }, { status: 400 });
  const [stt, tusdc] = await Promise.all([
    pub.getBalance({ address }),
    pub.readContract({ address: net.collateral, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  return NextResponse.json({ address, stt: formatUnits(stt, 18), tusdc: formatUnits(tusdc, net.collateralDecimals), collateral: net.collateral });
}

/** POST /api/wallet {privateKey, amount?} → calls the tUSDC faucet (needs STT for gas). */
export async function POST(req: Request) {
  if ((process.env.NETWORK ?? "testnet").toLowerCase() === "mainnet") return NextResponse.json({ error: "testnet only" }, { status: 400 });
  const body = (await req.json()) as { privateKey?: string; amount?: number };
  if (!body.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(body.privateKey)) return NextResponse.json({ error: "malformed private key" }, { status: 400 });
  const pk = body.privateKey as `0x${string}`;
  const address = privateKeyToAccount(pk).address;
  const stt = await pub.getBalance({ address });
  if (stt === 0n) return NextResponse.json({ error: "no STT for gas on this address; get some from the SomniaHacks Telegram faucet first", address }, { status: 400 });
  const ex = new SomniaMarkets({ indexerUrl: process.env.INDEXER_URL ?? net.indexerUrl, chain: somniaShannon, wsRpcUrl: process.env.WS_RPC_URL ?? net.wsRpcUrl, addresses: SOMNIA_TESTNET_ADDRESSES, privateKey: pk });
  try {
    const amount = BigInt(Math.min(10_000, Math.max(1, Math.floor(body.amount ?? 1000)))) * 10n ** BigInt(net.collateralDecimals);
    const res = await ex.trader.faucet({ amount });
    return NextResponse.json({ hash: res.hash, status: res.receipt.status, address });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0], address }, { status: 500 });
  }
}
