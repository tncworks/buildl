import { notFound } from "next/navigation";
import { runBacktest } from "@calibrate/backtest";
import type { TemplateId } from "@calibrate/backtest/types";
import { NETWORKS } from "@calibrate/shared";
import { getDb } from "@/lib/db";
import { getRunner } from "@/lib/runners";
import { LiveView } from "@/components/LiveView";
import { H1 } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getRunner(id);
  if (!r) notFound();
  const network = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
  const venueId = (process.env.VENUE_ID ?? NETWORKS[network].defaultVenueId).toLowerCase();
  let projection = null;
  try {
    projection = runBacktest(getDb(), { network, venueId, asset: r.spec.asset, intervalSec: r.spec.intervalSec, template: r.spec.template as TemplateId, params: r.spec.params }).summary;
  } catch {}
  return (
    <>
      <H1 sub={`Runner ${id}: ${r.spec.asset}/${r.spec.intervalSec}s · ${r.spec.template} · started ${new Date(r.startedAt).toISOString().slice(0, 19).replace("T", " ")} UTC`}>Live</H1>
      <LiveView id={id} projection={projection} />
    </>
  );
}
