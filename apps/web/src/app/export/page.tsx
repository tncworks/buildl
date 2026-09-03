import { listSeries } from "@calibrate/data";
import { TEMPLATES } from "@calibrate/backtest/templates";
import type { TemplateId } from "@calibrate/backtest/types";
import { NETWORKS } from "@calibrate/shared";
import { getDb } from "@/lib/db";
import { ExportStudio } from "@/components/ExportStudio";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ExportPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const network = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
  const venueId = (process.env.VENUE_ID ?? NETWORKS[network].defaultVenueId).toLowerCase();
  const series = listSeries(getDb(), network).filter((s) => s.venueId.toLowerCase() === venueId).map((s) => ({ asset: s.asset, intervalSec: s.intervalSec }));
  const template = (one(sp.template) && TEMPLATES[one(sp.template) as TemplateId] ? one(sp.template) : "momentum") as TemplateId;
  const params: Record<string, number> = {};
  for (const p of TEMPLATES[template].params) {
    const v = one(sp[p.key]);
    if (v !== undefined && Number.isFinite(Number(v))) params[p.key] = Number(v);
  }
  return <ExportStudio series={series.length ? series : [{ asset: "BTC", intervalSec: 300 }, { asset: "ETH", intervalSec: 300 }]} initial={{ asset: one(sp.asset) ?? "BTC", template, params }} />;
}
