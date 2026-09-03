import { NextResponse } from "next/server";
import { getCalibration, listSeries } from "@calibrate/data";
import { NETWORKS } from "@calibrate/shared";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const network = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
  const venueId = (u.searchParams.get("venue") ?? process.env.VENUE_ID ?? NETWORKS[network].defaultVenueId).toLowerCase();
  const db = getDb();
  if (u.searchParams.get("series") === "1") return NextResponse.json(listSeries(db, network));
  const key = { network, venueId, asset: (u.searchParams.get("asset") ?? "BTC").toUpperCase(), intervalSec: Number(u.searchParams.get("interval") ?? 300) };
  const tSec = Number(u.searchParams.get("t") ?? 60);
  return NextResponse.json({ key, tSec, bins: getCalibration(db, key, tSec) });
}
