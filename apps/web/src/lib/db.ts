import "server-only";
import { openDb, type Db } from "@calibrate/data";

let db: Db | undefined;

/** Process-wide read handle. SQLite in WAL mode allows the sync CLI to write concurrently. */
export function getDb(): Db {
  if (!db) db = openDb();
  return db;
}
