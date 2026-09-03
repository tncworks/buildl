"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { TEMPLATES, defaultParams } from "@calibrate/backtest/templates";
import type { TemplateId } from "@calibrate/backtest/types";
import { Badge, Card, Note } from "./ui";

interface Series { asset: string; intervalSec: number }
interface RunnerRow { id: string; spec: { asset: string; intervalSec: number; template: string; dryRun: boolean }; address: string | null; startedAt: number; stoppedAt: number | null; exitCode: number | null; eventCount: number; lastEvent: { type?: string } | null }

const KEY = "calibrate.burner";

export function DeployStudio({ series, initial }: { series: Series[]; initial: { asset: string; intervalSec: number; template: TemplateId; params: Record<string, number> } }) {
  const [pk, setPk] = useState<`0x${string}` | null>(null);
  const [balances, setBalances] = useState<{ stt: string; tusdc: string } | null>(null);
  const [asset, setAsset] = useState(initial.asset);
  const [intervalSec, setIntervalSec] = useState(initial.intervalSec);
  const [template, setTemplate] = useState<TemplateId>(initial.template);
  const [params, setParams] = useState<Record<string, number>>({ ...defaultParams(initial.template), ...initial.params });
  const [dryRun, setDryRun] = useState(true);
  const [runners, setRunners] = useState<RunnerRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const address = pk ? privateKeyToAccount(pk).address : null;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved && /^0x[0-9a-fA-F]{64}$/.test(saved)) setPk(saved as `0x${string}`);
    } catch {}
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!address) return;
    const r = await fetch(`/api/wallet?address=${address}`).then((x) => x.json());
    if (r.stt !== undefined) setBalances({ stt: r.stt, tusdc: r.tusdc });
  }, [address]);
  const refreshRunners = useCallback(async () => setRunners(await fetch("/api/runners").then((x) => x.json())), []);

  useEffect(() => { void refreshBalances(); }, [refreshBalances]);
  useEffect(() => {
    void refreshRunners();
    const t = setInterval(refreshRunners, 5000);
    return () => clearInterval(t);
  }, [refreshRunners]);

  const newKey = () => {
    const k = generatePrivateKey();
    try { sessionStorage.setItem(KEY, k); } catch {}
    setPk(k);
    setBalances(null);
    setMsg("Burner key generated in this browser tab and kept in sessionStorage only. It is sent to this server once, when you start a live run.");
  };
  const forget = () => { try { sessionStorage.removeItem(KEY); } catch {} setPk(null); setBalances(null); };

  const faucet = async () => {
    if (!pk) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ privateKey: pk, amount: 1000 }) }).then((x) => x.json());
    setBusy(false);
    setMsg(r.error ? `Faucet failed: ${r.error}` : `Faucet tx ${r.hash} (${r.status}).`);
    void refreshBalances();
  };

  const start = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/runners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ privateKey: dryRun ? undefined : pk, asset, intervalSec, template, params, dryRun }) }).then((x) => x.json());
    setBusy(false);
    setMsg(r.error ? `Start failed: ${r.error}` : `Started runner ${r.id}.`);
    void refreshRunners();
  };
  const stop = async (id: string) => { await fetch(`/api/runners/${id}`, { method: "DELETE" }); void refreshRunners(); };

  const spec = TEMPLATES[template];
  const canLive = !!pk && balances !== null && Number(balances.stt) > 0 && Number(balances.tusdc) > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Burner wallet (testnet)</div>
          {address ? (
            <>
              <div className="break-all font-mono text-sm">{address}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-ground px-3 py-2"><div className="text-xs text-muted">STT (gas)</div><div className="tnum font-mono">{balances ? Number(balances.stt).toFixed(4) : "…"}</div></div>
                <div className="rounded-md bg-ground px-3 py-2"><div className="text-xs text-muted">tUSDC</div><div className="tnum font-mono">{balances ? Number(balances.tusdc).toFixed(2) : "…"}</div></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={faucet} disabled={busy || !balances || Number(balances.stt) === 0} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40">Mint 1,000 tUSDC</button>
                <button onClick={refreshBalances} className="rounded-md border border-line px-3 py-1.5 text-sm">Refresh</button>
                <button onClick={forget} className="rounded-md border border-line px-3 py-1.5 text-sm text-muted">Forget key</button>
              </div>
              <p className="mt-3 text-xs text-muted">Gas (STT) cannot be minted here. Post this address in the SomniaHacks faucet topic: <a className="text-accent underline" href="https://t.me/+XHq0F0JXMyhmMzM0" target="_blank" rel="noreferrer">t.me/+XHq0F0JXMyhmMzM0</a>. Once STT arrives, the tUSDC button works.</p>
            </>
          ) : (
            <button onClick={newKey} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">Generate burner key</button>
          )}
        </Card>
        <Card>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Strategy</div>
          <div className="flex flex-wrap gap-1.5">
            {series.map((x) => (
              <button key={`${x.asset}${x.intervalSec}`} onClick={() => { setAsset(x.asset); setIntervalSec(x.intervalSec); }}
                className={`rounded-md border px-2.5 py-1 font-mono text-xs ${x.asset === asset && x.intervalSec === intervalSec ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}>{x.asset}/{x.intervalSec}s</button>
            ))}
          </div>
          <select value={template} onChange={(e) => { const id = e.target.value as TemplateId; setTemplate(id); setParams(defaultParams(id)); }} className="mt-3 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm">
            {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => <option key={id} value={id}>{TEMPLATES[id].name}</option>)}
          </select>
          <div className="mt-3 flex flex-col gap-2">
            {spec.params.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 text-muted">{p.label}</span>
                <input type="number" min={p.min} max={p.max} step={p.step} value={params[p.key] ?? p.default} onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))} className="w-24 rounded-md border border-line bg-surface px-2 py-1 font-mono" />
              </label>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry run (log decisions, sign nothing)</label>
          <button onClick={start} disabled={busy || (!dryRun && !canLive)} className="mt-3 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40">{dryRun ? "Start dry run" : "Start live on testnet"}</button>
          {!dryRun && !canLive ? <p className="mt-2 text-xs text-muted">Live needs a burner with both STT and tUSDC.</p> : null}
        </Card>
        {msg ? <Note>{msg}</Note> : null}
      </div>
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Runners</div>
          {runners.length === 0 ? <div className="py-6 text-center text-sm text-muted">No runners yet.</div> : (
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wider text-muted"><tr><th className="py-1.5 pr-3">Id</th><th className="py-1.5 pr-3">Strategy</th><th className="py-1.5 pr-3">Mode</th><th className="py-1.5 pr-3">Address</th><th className="py-1.5 pr-3">Started</th><th className="py-1.5 pr-3">State</th><th></th></tr></thead>
              <tbody className="font-mono">
                {runners.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-1.5 pr-3"><Link className="text-accent underline" href={`/live/${r.id}`}>{r.id}</Link></td>
                    <td className="py-1.5 pr-3">{r.spec.asset}/{r.spec.intervalSec}s · {r.spec.template}</td>
                    <td className="py-1.5 pr-3">{r.spec.dryRun ? <Badge tone="warn">dry</Badge> : <Badge tone="up">live</Badge>}</td>
                    <td className="py-1.5 pr-3">{r.address ? r.address.slice(0, 8) + "…" : "–"}</td>
                    <td className="py-1.5 pr-3">{new Date(r.startedAt).toISOString().slice(11, 19)}</td>
                    <td className="py-1.5 pr-3">{r.stoppedAt ? `exited ${r.exitCode}` : `${r.eventCount} events`}</td>
                    <td className="py-1.5">{r.stoppedAt ? null : <button onClick={() => stop(r.id)} className="rounded-md border border-line px-2 py-0.5">Stop</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Note>Hosted runners are testnet only. The server refuses to start one when NETWORK is mainnet, and the burner key is never written to disk: it is passed to the runner process environment once and forgotten by the web app.</Note>
      </div>
    </div>
  );
}
