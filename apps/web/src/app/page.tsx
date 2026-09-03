import Link from "next/link";
import { getCalibration, listSeries } from "@calibrate/data";
import { NETWORKS } from "@calibrate/shared";
import { getDb } from "@/lib/db";
import { CalibrationChart } from "@/components/CalibrationChart";
import { Card, H1, Note, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MapPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const db = getDb();
  const network = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
  const venueId = (process.env.VENUE_ID ?? NETWORKS[network].defaultVenueId).toLowerCase();
  const series = listSeries(db, network).filter((s) => s.venueId.toLowerCase() === venueId);
  const asset = one(sp.asset) ?? "BTC";
  const intervalSec = Number(one(sp.interval) ?? 300);
  const tSec = Number(one(sp.t) ?? 60);
  const minN = Number(one(sp.minN) ?? 5);
  const key = { network, venueId, asset, intervalSec };
  const bins = getCalibration(db, key, tSec);
  const cur = series.find((s) => s.asset === asset && s.intervalSec === intervalSec);
  const n = bins.reduce((a, b) => a + b.n, 0);
  const upWins = bins.reduce((a, b) => a + b.upWins, 0);
  const sumProb = bins.reduce((a, b) => a + b.meanProb * b.n, 0);
  const strongest = bins.filter((b) => b.n >= minN).map((b) => ({ ...b, edge: b.upWins / b.n - b.meanProb })).sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];

  if (series.length === 0) {
    return (
      <>
        <H1>Calibration map</H1>
        <Note>No settled windows in the database yet. Run <code className="font-mono">npm run sync</code> from the build directory, then reload.</Note>
      </>
    );
  }

  return (
    <>
      <H1 sub="When the book traded Up at a given probability shortly before expiry, how often did Up actually win? Points on the dashed diagonal are fairly priced. Points off it are edges, sized by sample count.">
        Calibration map
      </H1>

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {series.map((s) => {
          const active = s.asset === asset && s.intervalSec === intervalSec;
          return (
            <Link key={`${s.asset}-${s.intervalSec}`} href={`/?asset=${s.asset}&interval=${s.intervalSec}&t=${tSec}&minN=${minN}`}
              className={`rounded-md border px-3 py-1.5 font-mono ${active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink"}`}>
              {s.asset}/{s.intervalSec}s <span className="opacity-70">· {s.traded}/{s.windows} traded</span>
            </Link>
          );
        })}
        <span className="ml-auto text-muted">Decision time</span>
        {[30, 60, 120].map((t) => (
          <Link key={t} href={`/?asset=${asset}&interval=${intervalSec}&t=${t}&minN=${minN}`}
            className={`rounded-md border px-3 py-1.5 font-mono ${t === tSec ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink"}`}>
            T−{t}s
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CalibrationChart bins={bins} minN={minN} />
          <p className="mt-2 text-xs text-muted">Showing bins with at least {minN} windows. Bars are Wilson 95% intervals. Green: Up underpriced. Rust: Down underpriced.</p>
        </Card>
        <div className="flex flex-col gap-3">
          <Stat label="Windows with a print at T" value={n} sub={cur ? `${cur.traded} of ${cur.windows} windows traded at all` : undefined} />
          <Stat label="Realized Up rate" value={n ? (upWins / n).toFixed(3) : "–"} sub={n ? `mean traded price ${(sumProb / n).toFixed(3)}` : undefined} />
          {strongest ? (
            <Stat label="Largest edge (n ≥ minN)" tone={strongest.edge > 0 ? "up" : "down"}
              value={`${strongest.edge > 0 ? "+" : ""}${strongest.edge.toFixed(3)}`}
              sub={`price ${strongest.binLow.toFixed(2)}–${strongest.binHigh.toFixed(2)}, n=${strongest.n}, Up won ${(strongest.upWins / strongest.n).toFixed(2)}`} />
          ) : null}
          <Link href={`/backtest?asset=${asset}&interval=${intervalSec}&template=mispricing&seconds_left=${tSec}`}
            className="mt-2 rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:opacity-90">
            Backtest this edge →
          </Link>
        </div>
      </div>

      <Card className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted">
            <tr><th className="py-2 pr-4">Price bin</th><th className="py-2 pr-4">Windows</th><th className="py-2 pr-4">Mean price</th><th className="py-2 pr-4">Up won</th><th className="py-2 pr-4">Up rate</th><th className="py-2 pr-4">Edge</th></tr>
          </thead>
          <tbody className="tnum font-mono">
            {bins.map((b) => {
              const rate = b.upWins / b.n, edge = rate - b.meanProb;
              return (
                <tr key={b.bin} className="border-t border-line">
                  <td className="py-1.5 pr-4">{b.binLow.toFixed(2)}–{b.binHigh.toFixed(2)}</td>
                  <td className="py-1.5 pr-4">{b.n}</td>
                  <td className="py-1.5 pr-4">{b.meanProb.toFixed(3)}</td>
                  <td className="py-1.5 pr-4">{b.upWins}</td>
                  <td className="py-1.5 pr-4">{rate.toFixed(3)}</td>
                  <td className={`py-1.5 pr-4 ${b.n < minN ? "text-muted" : edge > 0.05 ? "text-up" : edge < -0.05 ? "text-down" : ""}`}>{edge >= 0 ? "+" : ""}{edge.toFixed(3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
