import { moveBps } from "@calibrate/shared";
import type { Decision, DecisionContext, TemplateId, TemplateSpec } from "./types";

/** Shared parameters every taker template exposes. */
const TAKER_COMMON = [
  { key: "seconds_left", label: "Decide with N seconds left", min: 10, max: 240, step: 5, default: 60, unit: "s", help: "Decision time is expiry minus this. Only data at or before that instant is visible." },
  { key: "max_price", label: "Max price to pay", min: 0.05, max: 0.99, step: 0.01, default: 0.9, help: "Skip the window if the estimated fill for the chosen side exceeds this." },
  { key: "size", label: "Contracts per trade", min: 1, max: 100, step: 1, default: 5, help: "Contracts bought when the template fires." },
  { key: "slippage_ticks", label: "Slippage (ticks)", min: 0, max: 20, step: 1, default: 2, help: "Added to the last print to estimate the taker fill. One tick is 0.001." },
  { key: "stale_sec", label: "Max print age", min: 5, max: 300, step: 5, default: 60, unit: "s", help: "Skip if the last print is older than this at decision time." },
] as const;

export const TEMPLATES: Record<TemplateId, TemplateSpec> = {
  momentum: {
    id: "momentum",
    name: "Momentum vs opening price",
    summary: "If spot has moved past the window's opening price by a threshold with N seconds left, buy the side spot favours and hold to settlement.",
    fillAssumption: "Taker fill estimated as the last printed YES price at or before the decision time, plus slippage. Windows without a fresh print are skipped, not filled.",
    params: [
      { key: "move_bps", label: "Min move vs open", min: 0, max: 50, step: 0.5, default: 3, unit: "bps", help: "Spot must be at least this far from the opening price (either direction)." },
      ...TAKER_COMMON,
    ],
  },
  mispricing: {
    id: "mispricing",
    name: "Late-window mispricing",
    summary: "If the last print sits in a probability bucket whose realized Up rate (measured on earlier windows only) differs from the price by more than an edge, buy the underpriced side.",
    fillAssumption: "Taker fill estimated as the last printed YES price at or before the decision time, plus slippage. Calibration is walk-forward: only windows that expired before the current one are used.",
    params: [
      { key: "edge", label: "Min edge", min: 0.01, max: 0.5, step: 0.01, default: 0.1, help: "Realized rate minus price must exceed this." },
      { key: "min_bin_n", label: "Min samples in bucket", min: 1, max: 200, step: 1, default: 15, help: "Ignore buckets with fewer earlier windows than this." },
      ...TAKER_COMMON,
    ],
  },
  ladder: {
    id: "ladder",
    name: "Probability ladder",
    summary: "Rest bids for one side at evenly spaced prices after the window opens and hold anything filled to settlement.",
    fillAssumption: "A rung counts as filled only if a later print traded at or below its price. Queue position and partial fills are not simulated; this is an upper bound on fills.",
    params: [
      { key: "side_up", label: "Side (1 = Up, 0 = Down)", min: 0, max: 1, step: 1, default: 1, help: "Which outcome the ladder buys." },
      { key: "low_price", label: "Lowest rung", min: 0.02, max: 0.9, step: 0.01, default: 0.2, help: "Price of the cheapest bid." },
      { key: "high_price", label: "Highest rung", min: 0.05, max: 0.95, step: 0.01, default: 0.4, help: "Price of the most expensive bid." },
      { key: "rungs", label: "Rungs", min: 1, max: 10, step: 1, default: 3, help: "Number of bids between low and high." },
      { key: "size_per_rung", label: "Contracts per rung", min: 1, max: 100, step: 1, default: 2, help: "Contracts on each rung." },
      { key: "delay_sec", label: "Place after open", min: 0, max: 240, step: 5, default: 30, unit: "s", help: "Seconds after trading starts before the ladder is placed." },
    ],
  },
};

export function defaultParams(id: TemplateId): Record<string, number> {
  return Object.fromEntries(TEMPLATES[id].params.map((p) => [p.key, p.default]));
}

/** Momentum: spot vs opening reference at decision time. */
export function decideMomentum(ctx: DecisionContext): Decision | { skip: "no-reference" | "no-spot" | "no-signal" } {
  if (ctx.openRef === null) return { skip: "no-reference" };
  if (!ctx.spot) return { skip: "no-spot" };
  const bps = moveBps(ctx.spot.price, ctx.openRef);
  const th = ctx.params.move_bps ?? 0;
  if (bps >= th) return { side: "UP", reason: `spot ${ctx.spot.price} is +${bps.toFixed(1)}bps vs open ${ctx.openRef}`, limitPrice: ctx.params.max_price ?? 1 };
  if (bps <= -th) return { side: "DOWN", reason: `spot ${ctx.spot.price} is ${bps.toFixed(1)}bps vs open ${ctx.openRef}`, limitPrice: ctx.params.max_price ?? 1 };
  return { skip: "no-signal" };
}

/** Mispricing: last print vs walk-forward calibration for its bucket. */
export function decideMispricing(ctx: DecisionContext): Decision | { skip: "no-prints" | "no-calibration" | "no-signal" } {
  if (!ctx.lastPrint) return { skip: "no-prints" };
  const secondsLeft = ctx.expiry - ctx.t;
  const cal = ctx.calibration(secondsLeft, ctx.lastPrint.prob);
  if (!cal || cal.n < (ctx.params.min_bin_n ?? 1)) return { skip: "no-calibration" };
  const p = ctx.lastPrint.prob;
  const edge = ctx.params.edge ?? 0;
  if (cal.upRate - p >= edge) return { side: "UP", reason: `print ${p.toFixed(3)} but bucket realized Up ${cal.upRate.toFixed(3)} (n=${cal.n})`, limitPrice: ctx.params.max_price ?? 1 };
  if (p - cal.upRate >= edge) return { side: "DOWN", reason: `print ${p.toFixed(3)} but bucket realized Up ${cal.upRate.toFixed(3)} (n=${cal.n})`, limitPrice: ctx.params.max_price ?? 1 };
  return { skip: "no-signal" };
}

export function isDecision(d: Decision | { skip: string }): d is Decision {
  return (d as Decision).side !== undefined;
}

/** Rung prices for the ladder, ascending. */
export function ladderRungs(params: Record<string, number>): number[] {
  const n = Math.max(1, Math.round(params.rungs ?? 1));
  const lo = params.low_price ?? 0.2;
  const hi = params.high_price ?? 0.4;
  if (n === 1) return [lo];
  const step = (hi - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => Number((lo + i * step).toFixed(4)));
}
