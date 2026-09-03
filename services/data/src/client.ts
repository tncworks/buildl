import { SomniaMarkets, SOMNIA_MAINNET_ADDRESSES, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaMainnet, somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { NETWORKS, type Network, type NetworkInfo } from "@calibrate/shared";
import { config as dotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

let envLoaded = false;
/** Directory that holds the .env in use (the repo root); relative DATA_DB paths resolve against it. */
export let envDir: string = process.cwd();
/** Load the nearest .env walking up from cwd (same approach as ec-core's loadEnv). */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenv({ path: candidate });
      envDir = dir;
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export function networkFromEnv(): Network {
  loadEnv();
  const raw = (process.env.NETWORK ?? "testnet").toLowerCase();
  return raw === "mainnet" ? "mainnet" : "testnet";
}

/** Endpoints for a network, with .env overrides applied. */
export function endpoints(network: Network): NetworkInfo {
  loadEnv();
  const base = NETWORKS[network];
  return {
    ...base,
    rpcUrl: process.env.RPC_URL ?? base.rpcUrl,
    wsRpcUrl: process.env.WS_RPC_URL ?? base.wsRpcUrl,
    indexerUrl: process.env.INDEXER_URL ?? base.indexerUrl,
    priceFeedUrl: process.env.PRICE_FEED_URL ?? base.priceFeedUrl,
    priceFeedQuote: process.env.PRICE_FEED_QUOTE ?? base.priceFeedQuote,
  };
}

/**
 * Read-only SDK exchange (no signer). `SomniaMarketsConfig` makes `privateKey`
 * optional (unified/exchange.d.ts:14); all reads in docs/verification ran this way.
 */
export function readOnlyExchange(network: Network): SomniaMarkets {
  const ep = endpoints(network);
  return new SomniaMarkets({
    indexerUrl: ep.indexerUrl,
    chain: network === "testnet" ? somniaShannon : somniaMainnet,
    wsRpcUrl: ep.wsRpcUrl,
    addresses: network === "testnet" ? SOMNIA_TESTNET_ADDRESSES : SOMNIA_MAINNET_ADDRESSES,
    priceFeed: ep.priceFeedUrl ? { url: ep.priceFeedUrl, quote: ep.priceFeedQuote } : undefined,
  });
}
