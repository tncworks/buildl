/**
 * Print one window's stored data side by side with a fresh read from the indexer,
 * so the DB can be checked against the source by eye.
 *
 *   npm run spotcheck -w @calibrate/data -- <marketId>
 *   npm run spotcheck -w @calibrate/data          # picks the most-traded stored window
 */
import { feedRawToNumber, oracleRawToNumber, priceRawToProb } from "@calibrate/shared";
import { networkFromEnv, readOnlyExchange } from "./client";
import { openDb } from "./db";
import { getFills, getMarket, spotAt } from "./queries";

const db = openDb();
const network = networkFromEnv();
let marketId = process.argv[2]?.toLowerCase();
if (!marketId) {
  const row = db.prepare("SELECT marketId FROM markets WHERE network = ? ORDER BY tradeCount DESC LIMIT 1").get(network) as { marketId: string } | undefined;
  if (!row) throw new Error("no markets in DB; run sync first");
  marketId = row.marketId;
}
const m = getMarket(db, marketId);
if (!m) throw new Error(`market ${marketId} not in DB`);
const fills = getFills(db, marketId);
const feat = db.prepare("SELECT * FROM window_features WHERE marketId = ?").get(marketId) as Record<string, unknown> | undefined;

console.log("== stored market");
console.log({ ...m, question: (m.question ?? "").slice(0, 60) });
console.log(`== stored fills: ${fills.length}`);
for (const f of fills.slice(0, 5)) console.log(`  ${f.ts} ${priceRawToProb(f.fillPriceRaw, m.quoteDecimals).toFixed(3)} x ${Number(f.quantityRaw) / 10 ** m.baseDecimals} ${f.kind} ${f.takerSide}`);
if (fills.length > 5) console.log(`  … ${fills.length - 5} more`);
console.log("== stored features", feat);
const sym = `${m.asset}/USDC`;
for (const t of [120, 60, 30]) {
  const s = spotAt(db, sym, m.expiry - t);
  console.log(`  spot at expiry-${t}s: ${s ? `${feedRawToNumber(s.spotRaw)} (tick ts ${s.ts})` : "none"}`);
}
console.log(`  openRef=${m.openingAnswerRaw ? oracleRawToNumber(m.openingAnswerRaw) : null} closeRef=${m.closingAnswerRaw ? oracleRawToNumber(m.closingAnswerRaw) : null} winner=${m.winningOutcome === 0 ? "UP" : m.winningOutcome === 1 ? "DOWN" : "n/a"} voided=${m.voided}`);
if (m.openingAnswerRaw && m.closingAnswerRaw) {
  const up = oracleRawToNumber(m.closingAnswerRaw) >= oracleRawToNumber(m.openingAnswerRaw);
  console.log(`  consistency: close>=open → ${up ? "UP" : "DOWN"}; indexer winner → ${m.winningOutcome === 0 ? "UP" : "DOWN"} ${up === (m.winningOutcome === 0) ? "MATCH" : "MISMATCH"}`);
}

console.log("== fresh from indexer");
const ex = readOnlyExchange(network);
const live = await ex.client.getBinaryMarket(marketId);
console.log({ status: live?.status, winningOutcome: live?.winningOutcome, tradeCount: live?.tradeCount, expiry: live?.expiry, voided: live?.voided });
const freshFills = await ex.client.getFills(m.poolAddress, { since: m.tradingStart, until: m.expiry + 5, limit: 1000 });
const mine = freshFills.filter((f) => f.market.toLowerCase() === marketId);
console.log(`fresh fills for this market: ${mine.length} (stored ${fills.length}) ${mine.length === fills.length ? "MATCH" : "MISMATCH"}`);
const res = await ex.client.getMarketResolution(marketId);
console.log({ opening: res.openingAnswer?.numericValue, closing: res.closingAnswer?.numericValue, event: res.events[0]?.winningOutcome });
process.exit(0);
