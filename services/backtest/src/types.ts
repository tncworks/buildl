export type Side = "UP" | "DOWN";
export type TemplateId = "momentum" | "mispricing" | "ladder";

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  help: string;
}

export interface TemplateSpec {
  id: TemplateId;
  name: string;
  summary: string;
  /** What the fill model assumes for this template; shown verbatim in the UI. */
  fillAssumption: string;
  params: ParamSpec[];
}

/** Everything a template may look at when deciding, at decision time `t`. */
export interface DecisionContext {
  t: number;
  tradingStart: number;
  expiry: number;
  /** Last print at or before t: YES probability and its timestamp. */
  lastPrint: { prob: number; ts: number } | null;
  /** Underlying spot at or before t (price-feed units), and its tick timestamp. */
  spot: { price: number; ts: number } | null;
  /** Window reference (opening) price, or null. */
  openRef: number | null;
  /** Walk-forward calibration lookup: realized Up rate for a probability bucket at `secondsLeft`. */
  calibration: (secondsLeft: number, prob: number) => { n: number; upRate: number; meanProb: number } | null;
  params: Record<string, number>;
}

export interface Decision {
  side: Side;
  /** Human reason string, e.g. "spot +12.4bps vs open 77468.27". */
  reason: string;
  /** For taker templates: max acceptable price for this side. */
  limitPrice: number;
}

export type SkipReason =
  | "no-outcome"
  | "no-prints"
  | "no-fresh-print"
  | "no-reference"
  | "no-spot"
  | "no-signal"
  | "no-calibration"
  | "price-cap"
  | "size-zero";

export interface WindowResult {
  marketId: string;
  expiry: number;
  tradingStart: number;
  decisionAt: number | null;
  side: Side | null;
  reason: string | null;
  /** Price paid per contract for `side` (after slippage), or null. */
  price: number | null;
  /** YES-print used for the fill estimate, and its age at decision time. */
  printProb: number | null;
  printAge: number | null;
  size: number;
  outcome: "UP" | "DOWN" | "VOID" | null;
  payout: number | null;
  pnl: number | null;
  skipped: SkipReason | null;
}

export interface Summary {
  windows: number;
  eligible: number;
  trades: number;
  wins: number;
  hitRate: number | null;
  hitRateCi95: [number, number] | null;
  totalPnl: number;
  meanPnlPerContract: number | null;
  maxDrawdown: number;
  skipped: Partial<Record<SkipReason, number>>;
  equity: { expiry: number; cum: number }[];
}

export interface RunRequest {
  network: string;
  venueId: string;
  asset: string;
  intervalSec: number;
  template: TemplateId;
  params: Record<string, number>;
  from?: number;
  to?: number;
}

export interface RunResult {
  request: RunRequest;
  spec: TemplateSpec;
  summary: Summary;
  results: WindowResult[];
}
