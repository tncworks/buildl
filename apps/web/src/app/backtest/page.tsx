import { listSeries } from "@calibrate/data";
import { TEMPLATES } from "@calibrate/backtest/templates";
import type { TemplateId } from "@calibrate/backtest/types";
import { NETWORKS } from "@calibrate/shared";
import { getDb } from "@/lib/db";
import { BacktestStudio } from "@/components/BacktestStudio";
import { H1, Note } from "@/components/ui";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BacktestPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const network = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
  const venueId = (process.env.VENUE_ID ?? NETWORKS[network].defaultVenueId).toLowerCase();
  const series = listSeries(getDb(), network)
    .filter((s) => s.venueId.toLowerCase() === venueId)
    .map((s) => ({ asset: s.asset, intervalSec: s.intervalSec, windows: s.windows, traded: s.traded }));
  const template = (one(sp.template) && TEMPLATES[one(sp.template) as TemplateId] ? one(sp.template) : "momentum") as TemplateId;
  const params: Record<string, number> = {};
  for (const p of TEMPLATES[template].params) {
    const v = one(sp[p.key]);
    if (v !== undefined && Number.isFinite(Number(v))) params[p.key] = Number(v);
  }
  return (
    <>
      <H1 sub="Replay every settled window in a series. The template sees only data at or before its decision time; the fill is estimated from prints; the payout is the recorded outcome.">
        Backtest
      </H1>
      {series.length === 0 ? (
        <Note>No settled windows in the database yet. Run <code className="font-mono">npm run sync</code> first.</Note>
      ) : (
        <BacktestStudio series={series} initial={{ asset: one(sp.asset) ?? "BTC", intervalSec: Number(one(sp.interval) ?? 300), template, params }} />
      )}
    </>
  );
}
