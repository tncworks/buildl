"use client";

import { useEffect, useMemo, useState } from "react";
import type { Summary } from "@calibrate/backtest/types";
import { Badge, Card, Note, Stat } from "./ui";
import { EquityChart } from "./EquityChart";

type Ev = Record<string, unknown> & { t: number; type: string };

const short = (id: unknown) => (typeof id === "string" ? id.slice(-6) : "");
const ts = (t: number) => new Date(t).toISOString().slice(11, 19);

export function LiveView({ id, projection }: { id: string; projection: Summary | null }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const es = new EventSource(`/api/runners/${id}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as Ev;
      setEvents((prev) => [...prev.slice(-2999), e]);
      if (e.type === "exit") { setOpen(false); es.close(); }
    };
    es.onerror = () => setOpen(false);
    return () => es.close();
  }, [id]);

  const start = events.find((e) => e.type === "start");
  const settled = useMemo(() => events.filter((e) => e.type === "settled"), [events]);
  const orders = useMemo(() => events.filter((e) => e.type === "order"), [events]);
  const decisions = useMemo(() => events.filter((e) => e.type === "decision"), [events]);
  const filled = orders.filter((o) => Number(o.filled ?? 0) > 0 || o.dryRun);
  const wins = settled.filter((s) => Number(s.pnl) > 0).length;
  const pnl = settled.reduce((a, s) => a + Number(s.pnl ?? 0), 0);
  const equity = settled.reduce<{ expiry: number; cum: number }[]>((acc, s) => { const cum = (acc[acc.length - 1]?.cum ?? 0) + Number(s.pnl ?? 0); acc.push({ expiry: Math.floor(s.t / 1000), cum }); return acc; }, []);
  const snapshots = events.filter((e) => e.type === "tick" || e.type === "order" || e.type === "decision" || e.type === "settled" || e.type === "error" || e.type === "warn" || e.type === "start" || e.type === "stopping" || e.type === "stop" || e.type === "exit" || e.type === "claim" || e.type === "bookParams" || e.type === "stderr");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={open ? "up" : "neutral"}>{open ? "streaming" : "ended"}</Badge>
        {start ? <span className="font-mono text-xs text-muted">{String((start.spec as { asset?: string })?.asset)}/{String((start.spec as { intervalSec?: number })?.intervalSec)}s · {String((start.spec as { template?: string })?.template)} · {start.dryRun ? "dry run" : "live"} · {String(start.address ?? "no signer")}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Decisions" value={decisions.length} sub={`${decisions.filter((d) => !d.skipped).length} fired`} />
        <Stat label="Orders" value={orders.length} sub={`${filled.length} filled${start?.dryRun ? " (dry)" : ""}`} />
        <Stat label="Settled" value={settled.length} sub={settled.length ? `${wins} won` : undefined} />
        <Stat label="Realized PnL" value={pnl.toFixed(3)} tone={pnl > 0 ? "up" : pnl < 0 ? "down" : "neutral"} sub={projection?.meanPnlPerContract != null ? `backtest ${projection.meanPnlPerContract.toFixed(4)}/contract, hit ${((projection.hitRate ?? 0) * 100).toFixed(0)}%` : undefined} />
      </div>
      <Card>
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Live equity (settled trades)</div>
        <EquityChart points={equity} />
      </Card>
      {projection ? <Note>Backtest projection for the same parameters: {projection.trades} trades, hit rate {((projection.hitRate ?? 0) * 100).toFixed(1)}%, {projection.totalPnl.toFixed(2)} total PnL over {projection.eligible} windows. Live fills are real; the projection's fills were estimated from prints.</Note> : null}
      <Card className="overflow-x-auto">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Event log</div>
        <table className="w-full text-xs">
          <thead className="text-left uppercase tracking-wider text-muted"><tr><th className="py-1 pr-3">Time</th><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">Market</th><th className="py-1">Detail</th></tr></thead>
          <tbody className="font-mono">
            {[...snapshots].reverse().slice(0, 400).map((e, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-3 text-muted">{ts(e.t)}</td>
                <td className="py-1 pr-3"><Badge tone={e.type === "error" ? "down" : e.type === "order" || e.type === "settled" ? "up" : e.type === "decision" ? (e.skipped ? "warn" : "neutral") : "neutral"}>{e.type}</Badge></td>
                <td className="py-1 pr-3">{short(e.marketId)}</td>
                <td className="py-1 font-sans text-muted">{detail(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function detail(e: Ev): string {
  const { t: _t, type: _ty, marketId: _m, ...rest } = e;
  switch (e.type) {
    case "decision": return e.skipped ? `skipped ${e.skipped}${e.secondsLeft !== undefined ? ` (${e.secondsLeft}s left)` : ""}` : `${e.side} limit ${e.limit ?? ""} size ${e.size ?? ""} — ${e.reason ?? ""}`;
    case "order": return `${e.dryRun ? "[dry] " : ""}${e.side} @ ${e.limit} size ${e.size}${e.filled !== undefined ? ` filled ${e.filled}` : ""}${e.hash ? ` tx ${String(e.hash).slice(0, 12)}…` : ""}`;
    case "settled": return `${e.side} @ ${e.price} × ${e.filled} → ${e.outcome} pnl ${e.pnl}`;
    case "start": return `${e.dryRun ? "dry run" : "live"} on ${e.network}`;
    default: return JSON.stringify(rest).slice(0, 200);
  }
}
