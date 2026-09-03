import { NextResponse } from "next/server";
import { runBacktest } from "@calibrate/backtest";
import { TEMPLATES } from "@calibrate/backtest/templates";
import type { RunRequest, TemplateId } from "@calibrate/backtest/types";
import { NETWORKS } from "@calibrate/shared";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<RunRequest>;
  const network = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
  const template = body.template as TemplateId;
  if (!TEMPLATES[template]) return NextResponse.json({ error: `unknown template ${template}` }, { status: 400 });
  const params: Record<string, number> = {};
  for (const p of TEMPLATES[template].params) {
    const v = Number(body.params?.[p.key] ?? p.default);
    if (!Number.isFinite(v)) return NextResponse.json({ error: `bad param ${p.key}` }, { status: 400 });
    params[p.key] = Math.min(p.max, Math.max(p.min, v));
  }
  const t0 = performance.now();
  const out = runBacktest(getDb(), {
    network,
    venueId: (body.venueId ?? process.env.VENUE_ID ?? NETWORKS[network].defaultVenueId).toLowerCase(),
    asset: String(body.asset ?? "BTC").toUpperCase(),
    intervalSec: Number(body.intervalSec ?? 300),
    template,
    params,
    fillModel: body.fillModel === "book" ? "book" : "print",
    from: body.from,
    to: body.to,
  });
  return NextResponse.json({ ...out, ms: Math.round(performance.now() - t0) });
}
