import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";

export interface RunnerSpec {
  asset: string;
  intervalSec: number;
  template: string;
  params: Record<string, number>;
  dryRun: boolean;
}

export interface RunnerRecord {
  id: string;
  spec: RunnerSpec;
  address: string | null;
  startedAt: number;
  stoppedAt: number | null;
  exitCode: number | null;
  events: Record<string, unknown>[];
}

interface Live extends RunnerRecord {
  proc: ChildProcess;
  bus: EventEmitter;
  file: WriteStream;
}

// Survives Next dev HMR: keep the registry on globalThis.
const g = globalThis as unknown as { __calibrateRunners?: Map<string, Live> };
const registry = (g.__calibrateRunners ??= new Map<string, Live>());

const ROOT = resolve(process.cwd(), "../.."); // apps/web → build/
const MAX_EVENTS = 3000;

export function listRunners(): RunnerRecord[] {
  return [...registry.values()].map(strip).sort((a, b) => b.startedAt - a.startedAt);
}

export function getRunner(id: string): RunnerRecord | undefined {
  const r = registry.get(id);
  return r ? strip(r) : undefined;
}

function strip(r: Live): RunnerRecord {
  const { proc: _p, bus: _b, file: _f, ...rest } = r;
  return rest;
}

export function subscribe(id: string, fn: (e: Record<string, unknown>) => void): (() => void) | undefined {
  const r = registry.get(id);
  if (!r) return undefined;
  r.bus.on("event", fn);
  return () => r.bus.off("event", fn);
}

export function startRunner(spec: RunnerSpec, privateKey: string | undefined): RunnerRecord {
  if ((process.env.NETWORK ?? "testnet").toLowerCase() === "mainnet") throw new Error("hosted runners are testnet only");
  if (!spec.dryRun && !privateKey) throw new Error("a private key is required for a live run");
  const id = randomBytes(6).toString("hex");
  mkdirSync(resolve(ROOT, "data/runs"), { recursive: true });
  const file = createWriteStream(resolve(ROOT, `data/runs/${id}.jsonl`), { flags: "a" });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NETWORK: "testnet",
    DRY_RUN: spec.dryRun ? "true" : "false",
    STRATEGY_JSON: JSON.stringify({ asset: spec.asset, intervalSec: spec.intervalSec, template: spec.template, params: spec.params }),
  };
  if (privateKey) env.PRIVATE_KEY = privateKey; // lives only in the child's environment
  else delete env.PRIVATE_KEY;
  const proc = spawn(resolve(ROOT, "node_modules/.bin/tsx"), ["services/runner/src/runner.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  const live: Live = { id, spec, address: null, startedAt: Date.now(), stoppedAt: null, exitCode: null, events: [], proc, bus: new EventEmitter(), file };
  registry.set(id, live);

  const push = (e: Record<string, unknown>) => {
    live.events.push(e);
    if (live.events.length > MAX_EVENTS) live.events.splice(0, live.events.length - MAX_EVENTS);
    file.write(JSON.stringify(e) + "\n");
    live.bus.emit("event", e);
  };
  let buf = "";
  proc.stdout!.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        if (e.type === "start" && typeof e.address === "string") live.address = e.address;
        push(e);
      } catch {
        push({ t: Date.now(), type: "log", line });
      }
    }
  });
  proc.stderr!.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) if (line.trim()) push({ t: Date.now(), type: "stderr", line: line.slice(0, 500) });
  });
  proc.on("exit", (code) => {
    live.exitCode = code;
    live.stoppedAt = Date.now();
    push({ t: Date.now(), type: "exit", code });
    file.end();
  });
  return strip(live);
}

export function stopRunner(id: string): boolean {
  const r = registry.get(id);
  if (!r || r.stoppedAt) return false;
  r.proc.kill("SIGTERM");
  setTimeout(() => {
    if (!r.stoppedAt) r.proc.kill("SIGKILL");
  }, 30_000).unref();
  return true;
}
