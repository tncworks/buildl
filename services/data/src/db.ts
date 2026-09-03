import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { envDir, loadEnv } from "./client.js";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS markets (
  marketId TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  venueId TEXT NOT NULL,
  operatorId INTEGER,
  asset TEXT NOT NULL,
  intervalSec INTEGER NOT NULL,
  poolAddress TEXT NOT NULL,
  nonce TEXT,
  tradingStart INTEGER NOT NULL,
  expiry INTEGER NOT NULL,
  status TEXT NOT NULL,
  winningOutcome INTEGER,
  voided INTEGER NOT NULL DEFAULT 0,
  finalized INTEGER NOT NULL DEFAULT 0,
  tradeCount INTEGER NOT NULL DEFAULT 0,
  quoteVolumeRaw TEXT NOT NULL DEFAULT '0',
  baseVolumeRaw TEXT NOT NULL DEFAULT '0',
  quoteDecimals INTEGER NOT NULL,
  baseDecimals INTEGER NOT NULL,
  strikeRaw TEXT,
  openingAnswerRaw TEXT,
  closingAnswerRaw TEXT,
  resolvedAt INTEGER,
  question TEXT,
  detailSynced INTEGER NOT NULL DEFAULT 0,
  syncedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS markets_series ON markets(network, venueId, asset, intervalSec, expiry);

CREATE TABLE IF NOT EXISTS fills (
  id TEXT PRIMARY KEY,
  marketId TEXT NOT NULL,
  pool TEXT NOT NULL,
  ts INTEGER NOT NULL,
  fillPriceRaw TEXT NOT NULL,
  quantityRaw TEXT NOT NULL,
  quoteQuantityRaw TEXT NOT NULL,
  kind TEXT,
  makerSide TEXT,
  takerSide TEXT,
  maker TEXT,
  taker TEXT
);
CREATE INDEX IF NOT EXISTS fills_market_ts ON fills(marketId, ts);

CREATE TABLE IF NOT EXISTS orders (
  orderId TEXT PRIMARY KEY,
  marketId TEXT NOT NULL,
  owner TEXT NOT NULL,
  isBid INTEGER NOT NULL,
  side TEXT,
  priceRaw TEXT NOT NULL,
  fullQtyRaw TEXT NOT NULL,
  filledQtyRaw TEXT NOT NULL,
  remainingQtyRaw TEXT NOT NULL,
  status TEXT NOT NULL,
  rested INTEGER NOT NULL,
  cancelReason TEXT,
  placedAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  expireNs TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_market ON orders(marketId, placedAt);

CREATE TABLE IF NOT EXISTS price_points (
  symbol TEXT NOT NULL,
  ts INTEGER NOT NULL,
  spotRaw TEXT NOT NULL,
  markRaw TEXT NOT NULL,
  PRIMARY KEY (symbol, ts)
);

CREATE TABLE IF NOT EXISTS window_features (
  marketId TEXT PRIMARY KEY,
  nTrades INTEGER NOT NULL,
  firstTradeProb REAL,
  vwapProb REAL,
  lastTradeProbAtT30 REAL,
  lastTradeProbAtT60 REAL,
  lastTradeProbAtT120 REAL,
  lastTradeAgeAtT30 INTEGER,
  lastTradeAgeAtT60 INTEGER,
  lastTradeAgeAtT120 INTEGER,
  openRef REAL,
  closeRef REAL,
  spotAtT30 REAL,
  spotAtT60 REAL,
  spotAtT120 REAL,
  moveBpsAtT30 REAL,
  moveBpsAtT60 REAL,
  moveBpsAtT120 REAL
);

CREATE TABLE IF NOT EXISTS calibration (
  network TEXT NOT NULL,
  venueId TEXT NOT NULL,
  asset TEXT NOT NULL,
  intervalSec INTEGER NOT NULL,
  tSec INTEGER NOT NULL,
  bin INTEGER NOT NULL,
  n INTEGER NOT NULL,
  upWins INTEGER NOT NULL,
  sumProb REAL NOT NULL,
  PRIMARY KEY (network, venueId, asset, intervalSec, tSec, bin)
);

CREATE TABLE IF NOT EXISTS book_snapshots (
  marketId TEXT NOT NULL,
  ts INTEGER NOT NULL,
  yesBidRaw TEXT,
  yesBidQtyRaw TEXT,
  yesAskRaw TEXT,
  yesAskQtyRaw TEXT,
  depthJson TEXT,
  PRIMARY KEY (marketId, ts)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
`;

export type Db = DatabaseSync;

export function dbPath(): string {
  loadEnv();
  const p = process.env.DATA_DB ?? "./data/calibrate.sqlite";
  return isAbsolute(p) ? p : resolve(envDir, p);
}

export function openDb(path = dbPath()): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(SCHEMA);
  return db;
}

export function setMeta(db: Db, key: string, value: unknown): void {
  db.prepare("INSERT OR REPLACE INTO meta(key, value, updatedAt) VALUES (?, ?, ?)").run(
    key,
    typeof value === "string" ? value : JSON.stringify(value),
    Math.floor(Date.now() / 1000),
  );
}

export function getMeta<T = string>(db: Db, key: string): T | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

/** Run `fn` inside a transaction. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
