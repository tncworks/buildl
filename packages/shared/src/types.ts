/** Row shapes stored in SQLite by services/data and read by services/backtest and apps/web. */

export interface MarketRecord {
  marketId: string;
  network: string;
  venueId: string;
  operatorId: number | null;
  asset: string;
  intervalSec: number;
  poolAddress: string;
  nonce: string | null;
  tradingStart: number;
  expiry: number;
  status: string;
  /** 0 = Up/YES, 1 = Down/NO, null if voided or unknown. */
  winningOutcome: number | null;
  voided: number;
  finalized: number;
  tradeCount: number;
  quoteVolumeRaw: string;
  baseVolumeRaw: string;
  quoteDecimals: number;
  baseDecimals: number;
  /** 2-dp fixed strings, or null. */
  strikeRaw: string | null;
  openingAnswerRaw: string | null;
  closingAnswerRaw: string | null;
  resolvedAt: number | null;
  question: string | null;
  syncedAt: number;
}

export interface FillRecord {
  id: string;
  marketId: string;
  pool: string;
  ts: number;
  fillPriceRaw: string;
  quantityRaw: string;
  quoteQuantityRaw: string;
  kind: string | null;
  makerSide: string | null;
  takerSide: string | null;
  maker: string | null;
  taker: string | null;
}

export interface OrderRecord {
  orderId: string;
  marketId: string;
  owner: string;
  isBid: number;
  side: string | null;
  priceRaw: string;
  fullQtyRaw: string;
  filledQtyRaw: string;
  remainingQtyRaw: string;
  status: string;
  rested: number;
  cancelReason: string | null;
  placedAt: number;
  updatedAt: number;
  expireNs: string;
}

export interface PricePointRecord {
  symbol: string;
  ts: number;
  spotRaw: string;
  markRaw: string;
}

export interface SeriesKey {
  network: string;
  venueId: string;
  asset: string;
  intervalSec: number;
}

export interface CalibrationBin {
  tSec: number;
  bin: number;
  binLow: number;
  binHigh: number;
  n: number;
  upWins: number;
  meanProb: number;
}
