/**
 *   npm run backtest -- --asset BTC --interval 300 --template momentum --params '{"move_bps":3}' [--from ts --to ts] [--rows N] [--json]
 */
import { parseArgs } from "node:util";
import { openDb, networkFromEnv, endpoints } from "@calibrate/data";
import { runBacktest } from "./engine.js";
import type { TemplateId } from "./types.js";

const { values: a } = parseArgs({
  options: {
    asset: { type: "string", default: "BTC" },
    interval: { type: "string", default: "300" },
    template: { type: "string", default: "momentum" },
    params: { type: "string", default: "{}" },
    venue: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    rows: { type: "string", default: "0" },
    json: { type: "boolean", default: false },
  },
});

const network = networkFromEnv();
const venueId = a.venue ?? process.env.VENUE_ID ?? endpoints(network).defaultVenueId;
const db = openDb();
const t0 = performance.now();
const out = runBacktest(db, {
  network, venueId, asset: a.asset!.toUpperCase(), intervalSec: Number(a.interval), template: a.template as TemplateId,
  params: JSON.parse(a.params!), from: a.from ? Number(a.from) : undefined, to: a.to ? Number(a.to) : undefined,
});
const ms = performance.now() - t0;

if (a.json) {
  console.log(JSON.stringify({ ...out, results: out.results.slice(0, Number(a.rows) || undefined) }, null, 2));
} else {
  const s = out.summary;
  console.log(`${out.spec.name} on ${out.request.asset}/${out.request.intervalSec}s  params=${JSON.stringify({ ...Object.fromEntries(out.spec.params.map((p) => [p.key, p.default])), ...out.request.params })}`);
  console.log(`windows=${s.windows} eligible=${s.eligible} trades=${s.trades} wins=${s.wins} hitRate=${s.hitRate?.toFixed(3) ?? "-"} ci95=${s.hitRateCi95 ? s.hitRateCi95.map((x) => x.toFixed(3)).join("..") : "-"}`);
  console.log(`totalPnl=${s.totalPnl} meanPnl/contract=${s.meanPnlPerContract ?? "-"} maxDrawdown=${s.maxDrawdown} skipped=${JSON.stringify(s.skipped)} (${ms.toFixed(0)} ms)`);
  const n = Number(a.rows);
  if (n > 0) {
    console.log("marketId(last6) expiry decisionAt side print age price size outcome payout pnl skipped | reason");
    for (const r of out.results.filter((r) => !r.skipped).slice(0, n)) {
      console.log(`${r.marketId.slice(-6)} ${r.expiry} ${r.decisionAt} ${r.side} ${r.printProb?.toFixed(3)} ${r.printAge}s ${r.price} ${r.size} ${r.outcome} ${r.payout} ${r.pnl} ${r.skipped ?? ""} | ${r.reason}`);
    }
  }
}
