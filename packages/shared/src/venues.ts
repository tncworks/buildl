/**
 * Networks, endpoints and venues. Every value here was observed live on
 * 2026-09-03 (docs/verification/chainprobe.log, indexerprobe.log, probe2.log).
 */

export type Network = "testnet" | "mainnet";

export interface NetworkInfo {
  network: Network;
  chainId: number;
  rpcUrl: string;
  wsRpcUrl: string;
  indexerUrl: string;
  /** Oracle price feed GraphQL (undefined on mainnet: not bundled in the SDK). */
  priceFeedUrl?: string;
  priceFeedQuote: string;
  collateral: `0x${string}`;
  collateralSymbol: string;
  collateralDecimals: number;
  /** On-chain `getBinaryBookParams` for the default venue's pools. */
  tickRaw: bigint;
  lotRaw: bigint;
  minQuantityRaw: bigint;
  defaultVenueId: `0x${string}`;
}

export const NETWORKS: Record<Network, NetworkInfo> = {
  testnet: {
    network: "testnet",
    chainId: 50312,
    rpcUrl: "https://api.infra.testnet.somnia.network",
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    priceFeedUrl: "https://price-feed.dev.oracle.somnia.host/v1/graphql",
    priceFeedQuote: "USDC",
    collateral: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
    collateralSymbol: "tUSDC",
    collateralDecimals: 6,
    tickRaw: 1000n,
    lotRaw: 1000n,
    minQuantityRaw: 1000n,
    defaultVenueId: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
  },
  mainnet: {
    network: "mainnet",
    chainId: 5031,
    rpcUrl: "https://api.infra.mainnet.somnia.network",
    wsRpcUrl: "wss://api.infra.mainnet.somnia.network/ws",
    indexerUrl: "https://prd.smk.somnia.host/v1/graphql",
    priceFeedUrl: undefined,
    priceFeedQuote: "USDC",
    collateral: "0x00000022dA000002656c64D9eA6011ea952D008A",
    collateralSymbol: "USDso",
    collateralDecimals: 18,
    tickRaw: 1_000_000_000_000_000n,
    lotRaw: 1_000_000_000_000_000n,
    minQuantityRaw: 1_000_000_000_000_000n,
    defaultVenueId: "0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d",
  },
};

export interface VenueInfo {
  network: Network;
  venueId: `0x${string}`;
  operatorId: number;
  label: string;
  /** How the reference price is carried on this venue's rows. */
  referenceSource: "openingAnswer" | "strike";
}

export const KNOWN_VENUES: VenueInfo[] = [
  {
    network: "testnet",
    venueId: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
    operatorId: 2,
    label: "DreamDEX testnet (closes at or above opening)",
    referenceSource: "openingAnswer",
  },
  {
    network: "testnet",
    venueId: "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f",
    operatorId: 4,
    label: "Pricefeed test venue (explicit strike)",
    referenceSource: "strike",
  },
  {
    network: "mainnet",
    venueId: "0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d",
    operatorId: 5,
    label: "DreamDEX mainnet",
    referenceSource: "openingAnswer",
  },
];

export function venueInfo(network: Network, venueId: string): VenueInfo | undefined {
  const v = venueId.toLowerCase();
  return KNOWN_VENUES.find((k) => k.network === network && k.venueId.toLowerCase() === v);
}

/** Price-feed symbol for an asset, e.g. "BTC" → "BTC/USDC". */
export function feedSymbol(asset: string, quote = "USDC"): string {
  return `${asset.toUpperCase()}/${quote}`;
}
