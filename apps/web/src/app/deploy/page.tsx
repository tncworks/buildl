import { listSeries } from "@calibrate/data";
import { TEMPLATES } from "@calibrate/backtest/templates";
import type { TemplateId } from "@calibrate/backtest/types";
import { NETWORKS } from "@calibrate/shared";
import { getDb } from "@/lib/db";
import { DeployStudio } from "@/components/DeployStudio";
import { H1, Note } from "@/components/ui";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DeployPage({ searchParams }: { searchParams: Promise<Search> }) {
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
  return (
    <>
      <H1 sub="Generate a burner wallet in this browser, fund it, and run a tuned strategy live on Somnia testnet. Every decision, order, fill and claim streams to the live page.">Deploy</H1>
      {network === "mainnet" ? <Note>Hosted runners are disabled on mainnet. Use Export to run under the Bot Kit with your own key.</Note> : (
        <DeployStudio series={series.length ? series : [{ asset: "BTC", intervalSec: 300 }]} initial={{ asset: one(sp.asset) ?? "BTC", intervalSec: Number(one(sp.interval) ?? 300), template, params }} />
      )}
    </>
  );
}
