/** Cumulative PnL (collateral units) by trade order. Pure SVG. */
export function EquityChart({ points }: { points: { expiry: number; cum: number }[] }) {
  const W = 560, H = 200, L = 48, R = 12, T = 12, B = 28;
  const pw = W - L - R, ph = H - T - B;
  if (points.length === 0) return <div className="flex h-40 items-center justify-center text-sm text-muted">No trades in this run.</div>;
  const ys = [0, ...points.map((p) => p.cum)];
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const x = (i: number) => L + (points.length === 1 ? pw / 2 : (i / (points.length - 1)) * pw);
  const y = (v: number) => T + (1 - (v - lo) / span) * ph;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  const zeroY = y(0);
  const first = new Date(points[0]!.expiry * 1000), lastD = new Date(last.expiry * 1000);
  const fmt = (dt: Date) => dt.toISOString().slice(5, 16).replace("T", " ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Equity curve">
      <line x1={L} x2={L + pw} y1={zeroY} y2={zeroY} stroke="var(--grid)" strokeWidth="1" />
      <path d={d} fill="none" stroke={last.cum >= 0 ? "var(--up)" : "var(--down)"} strokeWidth="2" />
      <circle cx={x(points.length - 1)} cy={y(last.cum)} r="3.5" fill={last.cum >= 0 ? "var(--up)" : "var(--down)"} />
      <g fill="var(--muted)" fontSize="11" fontFamily="var(--font-mono)">
        <text x={L - 6} y={y(hi) + 4} textAnchor="end">{hi.toFixed(1)}</text>
        <text x={L - 6} y={y(lo) + 4} textAnchor="end">{lo.toFixed(1)}</text>
        <text x={L - 6} y={zeroY + 4} textAnchor="end">0</text>
        <text x={L} y={H - 8}>{fmt(first)}</text>
        <text x={L + pw} y={H - 8} textAnchor="end">{fmt(lastD)}</text>
      </g>
    </svg>
  );
}
