import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-surface p-5 ${className}`}>{children}</section>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" | "neutral" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`tnum mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {sub ? <div className="tnum mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "up" | "down" | "neutral" | "warn" }) {
  const cls =
    tone === "up" ? "bg-up-soft text-up" : tone === "down" ? "bg-down-soft text-down" : tone === "warn" ? "bg-warn-bg text-warn-ink" : "bg-accent-soft text-accent";
  return <span className={`inline-block rounded-full px-2 py-0.5 font-mono text-xs ${cls}`}>{children}</span>;
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-warn-bg px-4 py-3 text-sm text-warn-ink">{children}</div>;
}

export function H1({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{children}</h1>
      {sub ? <p className="mt-1 max-w-3xl text-sm text-muted">{sub}</p> : null}
    </div>
  );
}
