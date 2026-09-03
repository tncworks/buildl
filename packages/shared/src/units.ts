/**
 * Unit conversions for the three numeric scales in this system. Every scale was
 * verified against live data (see docs/verification/*.log):
 *
 *  - Book prices and fill prices: YES probability × 10^quoteDecimals.
 *    testnet quoteDecimals = 6  → "520000"  = 0.52
 *    mainnet quoteDecimals = 18 → "155000000000000000" = 0.155
 *  - Oracle answers (opening/closing, `strike`): 2-decimal fixed point.
 *    "248937" = 2489.37 ETH, "8117664" = 81176.64 BTC
 *  - Price feed ticks/candles: 18 decimals.
 *    "2489325000000000000000" = 2489.325
 */

export const ORACLE_DECIMALS = 2;
export const FEED_DECIMALS = 18;

/** Raw integer string/bigint at `decimals` → JS number (display / analytics only). */
export function rawToNumber(raw: string | bigint, decimals: number): number {
  const s = typeof raw === "bigint" ? raw.toString() : raw;
  if (!/^-?\d+$/.test(s)) throw new Error(`rawToNumber: not an integer string: ${s}`);
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;
  const padded = digits.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  const n = Number(`${intPart}.${fracPart}`);
  return neg ? -n : n;
}

/** Book/fill raw price → probability in [0, 1]. */
export function priceRawToProb(raw: string | bigint, quoteDecimals: number): number {
  return rawToNumber(raw, quoteDecimals);
}

/** Oracle 2-dp fixed → number (e.g. "248937" → 2489.37). */
export function oracleRawToNumber(raw: string | bigint): number {
  return rawToNumber(raw, ORACLE_DECIMALS);
}

/** Price feed 18-dp → number. */
export function feedRawToNumber(raw: string | bigint): number {
  return rawToNumber(raw, FEED_DECIMALS);
}

/** Probability → raw price snapped to the tick grid (round-to-nearest), as bigint. */
export function probToPriceRaw(prob: number, quoteDecimals: number, tickRaw: bigint): bigint {
  if (!(prob > 0 && prob < 1)) throw new Error(`probToPriceRaw: probability must be in (0,1), got ${prob}`);
  const one = 10n ** BigInt(quoteDecimals);
  // Work in integer ticks to avoid float drift on 18-dp venues.
  const ticksPerOne = one / tickRaw;
  const ticks = BigInt(Math.round(prob * Number(ticksPerOne)));
  const snapped = ticks * tickRaw;
  if (snapped <= 0n || snapped >= one) throw new Error(`probToPriceRaw: ${prob} snapped off the grid`);
  return snapped;
}

/** Human contract count → raw quantity snapped DOWN to the lot grid. May return 0n. */
export function sizeToQuantityRaw(size: number, baseDecimals: number, lotRaw: bigint): bigint {
  if (!(size >= 0)) throw new Error(`sizeToQuantityRaw: size must be >= 0, got ${size}`);
  const one = 10n ** BigInt(baseDecimals);
  const lotsPerOne = one / lotRaw;
  const lots = BigInt(Math.floor(size * Number(lotsPerOne) + 1e-9));
  return lots * lotRaw;
}

/** Basis-point move of `spot` relative to `ref`. */
export function moveBps(spot: number, ref: number): number {
  if (!(ref > 0)) throw new Error(`moveBps: ref must be > 0, got ${ref}`);
  return ((spot - ref) / ref) * 10_000;
}

/** Unix seconds → nanoseconds bigint, for `expireTimestampNs`. */
export function secToNs(sec: number): bigint {
  return BigInt(Math.floor(sec)) * 1_000_000_000n;
}
