import { NextResponse } from "next/server";
import { TEMPLATES } from "@calibrate/backtest/templates";
import type { TemplateId } from "@calibrate/backtest/types";
import { listRunners, startRunner } from "@/lib/runners";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listRunners().map((r) => ({ ...r, events: undefined, lastEvent: r.events[r.events.length - 1] ?? null, eventCount: r.events.length })));
}

export async function POST(req: Request) {
  const body = (await req.json()) as { privateKey?: string; asset?: string; intervalSec?: number; template?: TemplateId; params?: Record<string, number>; dryRun?: boolean };
  const template = body.template as TemplateId;
  if (!TEMPLATES[template]) return NextResponse.json({ error: "unknown template" }, { status: 400 });
  if (body.privateKey && !/^0x[0-9a-fA-F]{64}$/.test(body.privateKey)) return NextResponse.json({ error: "malformed private key" }, { status: 400 });
  const params: Record<string, number> = {};
  for (const p of TEMPLATES[template].params) params[p.key] = Math.min(p.max, Math.max(p.min, Number(body.params?.[p.key] ?? p.default)));
  try {
    const r = startRunner({ asset: String(body.asset ?? "BTC").toUpperCase(), intervalSec: Number(body.intervalSec ?? 300), template, params, dryRun: body.dryRun !== false }, body.privateKey);
    return NextResponse.json({ id: r.id, startedAt: r.startedAt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
