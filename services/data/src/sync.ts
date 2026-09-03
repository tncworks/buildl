/**
 * Sync CLI: settled binary markets + fills + orders + resolutions + opening prices
 * + price-feed ticks → SQLite, then window features and calibration.
 *
 *   npm run sync -w @calibrate/data -- --days 5 --assets BTC,ETH --intervals 300,900,3600
 *
 * Every read goes through the SDK except the two documented raw queries in gql.ts.
 */
import { parseArgs } from "node:util";
import type { BinaryMarket } from "@somnia-chain/markets-sdk";
import { feedSymbol } from "@calibrate/shared";
import { endpoints, networkFromEnv, readOnlyExchange } from "./client";
import { openDb, setMeta, transaction, type Db } from "./db";
import { fetchOrdersByMarket, streamPricePoints } from "./gql";
import { computeCalibration, computeFeatures } from "./features";

const { values: args } = parseArgs({
  options: {
    days: { type: "string", default: "5" },
    assets: { type: "string", default: "BTC,ETH" },
    intervals: { type: "string", default: "300,900,3600" },
    venue: { type: "string" },
    concurrency: { type: "string", default: "4" },
    "skip-prices": { type: "boolean", default: false },
    "skip-orders": { type: "boolean", default: false },
    "features-only": { type: "boolean", default: false },
  },
});

const network = networkFromEnv();
const ep = endpoints(network);
const venueId = (args.venue ?? process.env.VENUE_ID ?? ep.defaultVenueId).toLowerCase();
const assets = args.assets!.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const intervals = args.intervals!.split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
const days = Number(args.days);
const concurrency = Math.max(1, Number(args.concurrency));
const nowSec = Math.floor(Date.now() / 1000);
const floorExpiry = nowSec - days * 86_400;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function mapPool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

function upsertMarket(db: Db, m: BinaryMarket): boolean {
  const existing = db.prepare("SELECT status, detailSynced FROM markets WHERE marketId = ?").get(m.marketId.toLowerCase()) as
    | { status: string; detailSynced: number }
    | undefined;
  db.prepare(
    `INSERT OR REPLACE INTO markets (marketId, network, venueId, operatorId, asset, intervalSec, poolAddress, nonce,
      tradingStart, expiry, status, winningOutcome, voided, finalized, tradeCount, quoteVolumeRaw, baseVolumeRaw,
      quoteDecimals, baseDecimals, strikeRaw, openingAnswerRaw, closingAnswerRaw, resolvedAt, question, detailSynced, syncedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    m.marketId.toLowerCase(),
    network,
    (m.venueId ?? "").toLowerCase(),
    m.operatorId ?? null,
    m.asset,
    Number(m.intervalSec ?? 0),
    m.poolAddress.toLowerCase(),
    m.nonce ?? null,
    Number(m.tradingStart),
    Number(m.expiry),
    m.status,
    m.winningOutcome ?? null,
    m.voided ? 1 : 0,
    m.finalized ? 1 : 0,
    Number(m.tradeCount),
    m.cumulativeQuoteVolume,
    m.cumulativeBaseVolume,
    m.quoteDecimals,
    m.baseDecimals,
    m.strike ?? null,
    existing ? (db.prepare("SELECT openingAnswerRaw FROM markets WHERE marketId = ?").get(m.marketId.toLowerCase()) as { openingAnswerRaw: string | null }).openingAnswerRaw : null,
    existing ? (db.prepare("SELECT closingAnswerRaw FROM markets WHERE marketId = ?").get(m.marketId.toLowerCase()) as { closingAnswerRaw: string | null }).closingAnswerRaw : null,
    m.resolvedAtTimestamp ? Number(m.resolvedAtTimestamp) : null,
    m.question ?? null,
    existing?.detailSynced ?? 0,
    nowSec,
  );
  return !existing;
}

async function main() {
  const db = openDb();
  const ex = readOnlyExchange(network);
  const client = ex.client;
  log(`network=${network} venue=${venueId} assets=${assets.join(",")} intervals=${intervals.join(",")} days=${days} db=${process.env.DATA_DB ?? "./data/calibrate.sqlite"}`);

  if (!args["features-only"]) {
    // ---- 1. venue fees (verified zero on DreamDEX per docs; we record what the indexer says)
    // ---- 2. markets: page listPastBinaryMarkets per (asset, interval) until older than floor
    let newMarkets = 0;
    let seen = 0;
    for (const asset of assets) {
      for (const intervalSec of intervals) {
        const limit = 200;
        for (let offset = 0; ; offset += limit) {
          const rows = await client.listPastBinaryMarkets({ venueId, asset, intervalSec, status: "Finalized", limit, offset, nowSec });
          if (rows.length === 0) break;
          let stop = false;
          transaction(db, () => {
            for (const m of rows) {
              if (Number(m.expiry) < floorExpiry) {
                stop = true;
                continue;
              }
              seen++;
              if (upsertMarket(db, m)) newMarkets++;
            }
          });
          log(`markets ${asset}/${intervalSec}s offset=${offset} got=${rows.length} seen=${seen} new=${newMarkets}`);
          if (stop || rows.length < limit) break;
        }
      }
    }

    // ---- 3. per-market detail: fills, orders, resolution, for markets not yet detail-synced
    const pending = db
      .prepare(
        `SELECT marketId, poolAddress, tradingStart, expiry, tradeCount FROM markets
         WHERE network = ? AND lower(venueId) = ? AND detailSynced = 0 AND expiry >= ? ORDER BY expiry DESC`,
      )
      .all(network, venueId, floorExpiry) as unknown as { marketId: string; poolAddress: string; tradingStart: number; expiry: number; tradeCount: number }[];
    log(`detail sync for ${pending.length} markets (concurrency ${concurrency})`);

    let done = 0;
    await mapPool(pending, concurrency, async (m) => {
      const fills = m.tradeCount > 0 ? await client.getFills(m.poolAddress, { since: m.tradingStart, until: m.expiry + 5, limit: 1000 }) : [];
      const orders = m.tradeCount > 0 && !args["skip-orders"] ? await fetchOrdersByMarket(ep.indexerUrl, m.marketId) : [];
      const res = await client.getMarketResolution(m.marketId);
      transaction(db, () => {
        const fi = db.prepare(
          "INSERT OR REPLACE INTO fills (id, marketId, pool, ts, fillPriceRaw, quantityRaw, quoteQuantityRaw, kind, makerSide, takerSide, maker, taker) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        );
        for (const f of fills) {
          if (f.market.toLowerCase() !== m.marketId) continue; // pool recycled: keep only this market's fills
          fi.run(f.id, m.marketId, f.pool.toLowerCase(), Number(f.timestamp), f.fillPrice, f.quantity, f.quoteQuantity, f.kind, f.makerSide, f.takerSide, f.maker, f.taker);
        }
        const oi = db.prepare(
          "INSERT OR REPLACE INTO orders (orderId, marketId, owner, isBid, side, priceRaw, fullQtyRaw, filledQtyRaw, remainingQtyRaw, status, rested, cancelReason, placedAt, updatedAt, expireNs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        );
        for (const o of orders) {
          oi.run(o.orderId, m.marketId, o.owner.toLowerCase(), o.isBid ? 1 : 0, o.side, o.price, o.fullQuantity, o.filledQuantity, o.quantityRemaining, o.status, o.rested ? 1 : 0, o.cancelReason, Number(o.placedAtTimestamp), Number(o.lastUpdatedAtTimestamp), o.expireTimestampNs);
        }
        db.prepare("UPDATE markets SET openingAnswerRaw = COALESCE(?, openingAnswerRaw), closingAnswerRaw = COALESCE(?, closingAnswerRaw), detailSynced = 1 WHERE marketId = ?").run(
          res.openingAnswer?.numericValue ?? null,
          res.closingAnswer?.numericValue ?? null,
          m.marketId,
        );
      });
      done++;
      if (done % 100 === 0) log(`detail ${done}/${pending.length}`);
    });
    log(`detail done ${done}`);

    // ---- 4. opening prices in batches for markets still missing one
    const missing = db
      .prepare("SELECT marketId FROM markets WHERE network = ? AND lower(venueId) = ? AND openingAnswerRaw IS NULL AND expiry >= ?")
      .all(network, venueId, floorExpiry) as unknown as { marketId: string }[];
    log(`opening prices: ${missing.length} missing`);
    for (let i = 0; i < missing.length; i += 50) {
      const ids = missing.slice(i, i + 50).map((r) => r.marketId);
      const map = await client.getOpeningPrices(ids);
      transaction(db, () => {
        const up = db.prepare("UPDATE markets SET openingAnswerRaw = ? WHERE marketId = ?");
        for (const [id, v] of Object.entries(map)) if (v) up.run(v, id.toLowerCase());
      });
    }

    // ---- 5. price-feed ticks: one continuous stream per asset over the covered range
    if (!args["skip-prices"] && ep.priceFeedUrl) {
      for (const asset of assets) {
        const range = db
          .prepare("SELECT MIN(tradingStart) AS lo, MAX(expiry) AS hi FROM markets WHERE network = ? AND lower(venueId) = ? AND asset = ? AND expiry >= ?")
          .get(network, venueId, asset, floorExpiry) as { lo: number | null; hi: number | null };
        if (range.lo === null || range.hi === null) continue;
        const symbol = feedSymbol(asset, ep.priceFeedQuote);
        const have = db.prepare("SELECT MIN(ts) AS mn, MAX(ts) AS mx FROM price_points WHERE symbol = ?").get(symbol) as { mn: number | null; mx: number | null };
        const want = { from: range.lo - 60, to: range.hi + 5 };
        // Two sub-ranges: backfill before the oldest stored tick, and extend after the newest.
        const spans: [number, number][] = [];
        if (have.mn === null) spans.push([want.from, want.to]);
        else {
          if (want.from < have.mn - 1) spans.push([want.from, have.mn - 1]);
          if (want.to > (have.mx ?? 0)) spans.push([have.mx!, want.to]);
        }
        const ins = db.prepare("INSERT OR IGNORE INTO price_points (symbol, ts, spotRaw, markRaw) VALUES (?,?,?,?)");
        for (const [from, to] of spans) {
          log(`price ticks ${symbol} from=${from} to=${to} (${((to - from) / 3600).toFixed(1)}h)`);
          let pages = 0;
          const total = await streamPricePoints(ep.priceFeedUrl, symbol, from, to, (rows) => {
            transaction(db, () => {
              for (const r of rows) ins.run(symbol, Number(r.blockTimestamp), r.spot, r.mark);
            });
            pages++;
            if (pages % 50 === 0) log(`  ${symbol} pages=${pages} lastTs=${rows[rows.length - 1]!.blockTimestamp}`);
          });
          log(`price ticks ${symbol}: ${total} rows`);
        }
      }
    }
  }

  // ---- 6. features + calibration
  const nf = computeFeatures(db, { network, venueId });
  const nc = computeCalibration(db, { network });
  log(`features for ${nf} markets; calibration cells ${nc}`);
  setMeta(db, `lastSync:${network}:${venueId}`, { at: nowSec, days, assets, intervals });

  const counts = db.prepare("SELECT COUNT(*) AS markets, (SELECT COUNT(*) FROM fills) AS fills, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM price_points) AS ticks FROM markets").get();
  log("totals", counts);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
