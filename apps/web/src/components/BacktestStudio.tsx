"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TEMPLATES, defaultParams } from "@calibrate/backtest/templates";
import type { RunResult, TemplateId, WindowResult } from "@calibrate/backtest/types";
import { EquityChart } from "./EquityChart";
import { Badge, Card, Note, Stat } from "./ui";

interface Series { asset: string; intervalSec: number; windows: number; traded: number }

const fmtTs = (t: number) => new Date(t * 1000).toISOString().slice(5, 19).replace("T", " ");

export function BacktestStudio({ series, initial }: { series: Series[]; initial: { asset: string; intervalSec: number; template: TemplateId; params: Record<string, number> } }) {
  const [asset, setAsset] = useState(initial.asset);
  const [intervalSec, setIntervalSec] = useState(initial.intervalSec);
  const [template, setTemplate] = useState<TemplateId>(initial.template);
  const [params, setParams] = useState<Record<string, number>>({ ...defaultParams(initial.template), ...initial.params });
  const [result, setResult] = useState<(RunResult & { ms: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const spec = TEMPLATES[template];
  const reqId = useRef(0);

  const run = useCallback(async () => {
    const id = ++reqId.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asset, intervalSec, template, params }) });
      const json = await res.json();
      if (id !== reqId.current) return;
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setResult(json);
    } catch (e) {
      if (id === reqId.current) setError(String((e as Error).message ?? e));
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  }, [asset, intervalSec, template, params]);

  // Debounced auto-run on any change.
  useEffect(() => {
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [run]);

  const onTemplate = (id: TemplateId) => {
    setTemplate(id);
    setParams(defaultParams(id));
  };

  const s = result?.summary;
  const trades = useMemo(() => (result ? result.results.filter((r) => !r.skipped) : []), [result]);
  const skippedRows = useMemo(() => (result ? result.results.filter((r) => r.skipped && r.skipped !== "no-outcome") : []), [result]);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Series</div>
          <div className="flex flex-wrap gap-1.5">
            {series.map((x) => {
              const active = x.asset === asset && x.intervalSec === intervalSec;
              return (
                <button key={`${x.asset}${x.intervalSec}`} onClick={() => { setAsset(x.asset); setIntervalSec(x.intervalSec); }}
                  className={`rounded-md border px-2.5 py-1 font-mono text-xs ${active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"}`}>
                  {x.asset}/{x.intervalSec}s
                </button>
              );
            })}
          </div>
        </Card>
        <Card>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Template</div>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => (
              <button key={id} onClick={() => onTemplate(id)}
                className={`rounded-md border px-3 py-2 text-left text-sm ${id === template ? "border-accent bg-accent-soft" : "border-line hover:bg-ground"}`}>
                <div className="font-medium">{TEMPLATES[id].name}</div>
                <div className="mt-0.5 text-xs text-muted">{TEMPLATES[id].summary}</div>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Parameters</div>
          <div className="flex flex-col gap-3">
            {spec.params.map((p) => (
              <label key={p.key} className="block">
                <div className="flex items-baseline justify-between text-sm">
                  <span>{p.label}</span>
                  <span className="tnum font-mono text-xs text-accent">{params[p.key]}{p.unit ?? ""}</span>
                </div>
                <input type="range" min={p.min} max={p.max} step={p.step} value={params[p.key] ?? p.default}
                  onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))} className="mt-1 w-full" />
                <div className="text-xs text-muted">{p.help}</div>
              </label>
            ))}
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Note><strong>Fill model.</strong> {spec.fillAssumption}</Note>
        {error ? <Note>Backtest failed: {error}</Note> : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Trades" value={s ? s.trades : "–"} sub={s ? `${s.eligible} eligible windows` : undefined} />
          <Stat label="Hit rate" value={s?.hitRate != null ? (s.hitRate * 100).toFixed(1) + "%" : "–"} sub={s?.hitRateCi95 ? `95% CI ${(s.hitRateCi95[0] * 100).toFixed(0)}–${(s.hitRateCi95[1] * 100).toFixed(0)}%` : undefined} />
          <Stat label="Total PnL" value={s ? s.totalPnl.toFixed(2) : "–"} tone={s ? (s.totalPnl > 0 ? "up" : s.totalPnl < 0 ? "down" : "neutral") : "neutral"} sub={s?.meanPnlPerContract != null ? `${s.meanPnlPerContract.toFixed(4)} per contract` : undefined} />
          <Stat label="Max drawdown" value={s ? s.maxDrawdown.toFixed(2) : "–"} sub={result ? `${result.ms} ms` : undefined} />
        </div>
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-muted">Equity curve (collateral units)</div>
            {busy ? <span className="text-xs text-muted">running…</span> : null}
          </div>
          <EquityChart points={s?.equity ?? []} />
        </Card>
        {s ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(s.skipped).map(([k, v]) => (
              <Badge key={k} tone="neutral">{k}: {v}</Badge>
            ))}
            <button onClick={() => setShowSkipped((x) => !x)} className="text-muted underline-offset-2 hover:underline">{showSkipped ? "hide skipped windows" : "show skipped windows"}</button>
          </div>
        ) : null}
        <Card className="overflow-x-auto">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{showSkipped ? "Skipped windows" : "Decisions"}</div>
          <DecisionTable rows={showSkipped ? skippedRows : trades} />
        </Card>
      </div>
    </div>
  );
}

function DecisionTable({ rows }: { rows: WindowResult[] }) {
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-muted">Nothing to show.</div>;
  return (
    <table className="w-full text-xs">
      <thead className="text-left uppercase tracking-wider text-muted">
        <tr><th className="py-1.5 pr-3">Expiry (UTC)</th><th className="py-1.5 pr-3">Side</th><th className="py-1.5 pr-3">Print</th><th className="py-1.5 pr-3">Age</th><th className="py-1.5 pr-3">Price</th><th className="py-1.5 pr-3">Size</th><th className="py-1.5 pr-3">Outcome</th><th className="py-1.5 pr-3">PnL</th><th className="py-1.5">Reason</th></tr>
      </thead>
      <tbody className="tnum font-mono">
        {rows.slice(0, 300).map((r) => (
          <tr key={r.marketId} className="border-t border-line">
            <td className="py-1 pr-3">{fmtTs(r.expiry)}</td>
            <td className="py-1 pr-3">{r.side ? <Badge tone={r.side === "UP" ? "up" : "down"}>{r.side}</Badge> : "–"}</td>
            <td className="py-1 pr-3">{r.printProb?.toFixed(3) ?? "–"}</td>
            <td className="py-1 pr-3">{r.printAge != null ? `${r.printAge}s` : "–"}</td>
            <td className="py-1 pr-3">{r.price?.toFixed(3) ?? "–"}</td>
            <td className="py-1 pr-3">{r.size || "–"}</td>
            <td className="py-1 pr-3">{r.outcome ?? "–"}</td>
            <td className={`py-1 pr-3 ${r.pnl != null ? (r.pnl > 0 ? "text-up" : r.pnl < 0 ? "text-down" : "") : ""}`}>{r.pnl?.toFixed(3) ?? "–"}</td>
            <td className="py-1 font-sans text-muted">{r.skipped ? <Badge tone="warn">{r.skipped}</Badge> : r.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
