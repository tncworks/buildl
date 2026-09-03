import type { CalibrationBin } from "@calibrate/shared";
import { wilson95 } from "@calibrate/backtest/metrics";

/**
 * Calibration map: x = mean traded YES probability in the bin, y = realized Up rate.
 * Dot radius grows with sample size; vertical bars are Wilson 95% intervals.
 * Pure SVG, server-renderable; hover titles carry the exact numbers.
 */
export function CalibrationChart({ bins, minN = 1 }: { bins: CalibrationBin[]; minN?: number }) {
  const W = 560, H = 420, L = 48, R = 16, T = 16, B = 44;
  const pw = W - L - R, ph = H - T - B;
  const x = (p: number) => L + p * pw;
  const y = (p: number) => T + (1 - p) * ph;
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Calibration map">
      <g stroke="var(--grid)" strokeWidth="1">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={L + pw} y1={y(t)} y2={y(t)} />
            <line y1={T} y2={T + ph} x1={x(t)} x2={x(t)} />
          </g>
        ))}
      </g>
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 4" />
      <g fill="var(--muted)" fontSize="11" fontFamily="var(--font-mono)">
        {ticks.map((t) => (
          <text key={`x${t}`} x={x(t)} y={H - B + 18} textAnchor="middle">{t.toFixed(2)}</text>
        ))}
        {ticks.map((t) => (
          <text key={`y${t}`} x={L - 8} y={y(t) + 4} textAnchor="end">{t.toFixed(2)}</text>
        ))}
      </g>
      <g fill="var(--ink)" fontSize="12">
        <text x={L + pw / 2} y={H - 6} textAnchor="middle">Traded P(Up) at decision time</text>
        <text x={14} y={T + ph / 2} textAnchor="middle" transform={`rotate(-90 14 ${T + ph / 2})`}>Realized Up rate</text>
      </g>
      {bins.filter((b) => b.n >= minN).map((b) => {
        const rate = b.upWins / b.n;
        const [lo, hi] = wilson95(b.upWins, b.n);
        const r = 3 + 9 * Math.sqrt(b.n / maxN);
        const edge = rate - b.meanProb;
        const color = Math.abs(edge) < 0.05 ? "var(--accent)" : edge > 0 ? "var(--up)" : "var(--down)";
        return (
          <g key={b.bin}>
            <line x1={x(b.meanProb)} x2={x(b.meanProb)} y1={y(lo)} y2={y(hi)} stroke={color} strokeWidth="1.5" opacity="0.6" />
            <circle cx={x(b.meanProb)} cy={y(rate)} r={r} fill={color} fillOpacity="0.85" stroke="var(--surface)" strokeWidth="1.5">
              <title>{`bin [${b.binLow.toFixed(2)}, ${b.binHigh.toFixed(2)})  n=${b.n}  mean price ${b.meanProb.toFixed(3)}  Up rate ${rate.toFixed(3)}  95% CI ${lo.toFixed(2)}–${hi.toFixed(2)}  edge ${(edge >= 0 ? "+" : "") + edge.toFixed(3)}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
