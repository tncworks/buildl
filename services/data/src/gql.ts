/**
 * The ONLY file with raw GraphQL against the indexer / price feed. Everything the
 * SDK exposes is called through the SDK; these two queries cover what it does not:
 *   - orders by market (SDK's getOrders is by owner only)
 *   - price-feed tick pagination by blockTimestamp (SDK's fetchPriceHistory has no cursor)
 * Field names were verified by introspection (docs/verification/introspect.log, probe4.log).
 */

export interface GqlOptions {
  retries?: number;
  timeoutMs?: number;
}

export async function gql<T>(url: string, query: string, variables: Record<string, unknown>, opts: GqlOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });
      const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
      if (!res.ok || json.errors?.length) {
        throw new Error(`GraphQL ${res.status}: ${json.errors?.map((e) => e.message).join("; ") ?? res.statusText}`);
      }
      if (!json.data) throw new Error("GraphQL: empty data");
      return json.data;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export interface RawOrder {
  orderId: string;
  owner: string;
  isBid: boolean;
  side: string | null;
  price: string;
  fullQuantity: string;
  filledQuantity: string;
  quantityRemaining: string;
  status: string;
  rested: boolean;
  cancelReason: string | null;
  placedAtTimestamp: string;
  lastUpdatedAtTimestamp: string;
  expireTimestampNs: string;
}

const ORDERS_BY_MARKET = `
query OrdersByMarket($m: String!, $limit: Int!, $offset: Int!) {
  Order(where: {market_id: {_eq: $m}}, order_by: {placedAtTimestamp: asc}, limit: $limit, offset: $offset) {
    orderId owner isBid side price fullQuantity filledQuantity quantityRemaining
    status rested cancelReason placedAtTimestamp lastUpdatedAtTimestamp expireTimestampNs
  }
}`;

export async function fetchOrdersByMarket(indexerUrl: string, marketId: string): Promise<RawOrder[]> {
  const out: RawOrder[] = [];
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const data = await gql<{ Order: RawOrder[] }>(indexerUrl, ORDERS_BY_MARKET, { m: marketId.toLowerCase(), limit, offset });
    out.push(...data.Order);
    if (data.Order.length < limit) break;
  }
  return out;
}

export interface RawPricePoint {
  blockTimestamp: string;
  spot: string;
  mark: string;
}

const PRICE_POINTS = `
query PricePoints($s: String!, $from: numeric!, $to: numeric!, $limit: Int!) {
  PricePoint(where: {symbol: {_eq: $s}, blockTimestamp: {_gt: $from, _lte: $to}}, order_by: {blockTimestamp: asc}, limit: $limit) {
    blockTimestamp spot mark
  }
}`;

/**
 * Stream price ticks for `symbol` in (from, to], oldest first, in pages of `pageSize`.
 * Calls `onPage` for each page; returns the total count.
 */
export async function streamPricePoints(
  feedUrl: string,
  symbol: string,
  from: number,
  to: number,
  onPage: (rows: RawPricePoint[]) => void,
  pageSize = 1000,
): Promise<number> {
  let cursor = from;
  let total = 0;
  for (;;) {
    const data = await gql<{ PricePoint: RawPricePoint[] }>(feedUrl, PRICE_POINTS, { s: symbol, from: cursor, to, limit: pageSize });
    const rows = data.PricePoint;
    if (rows.length === 0) break;
    onPage(rows);
    total += rows.length;
    const last = rows[rows.length - 1]!;
    const lastTs = Number(last.blockTimestamp);
    if (rows.length < pageSize) break;
    // Same-second ticks: if the whole page shares one timestamp we would loop forever.
    if (lastTs === cursor) throw new Error(`price feed: ${pageSize}+ ticks at one second (${lastTs}) for ${symbol}`);
    cursor = lastTs;
  }
  return total;
}
