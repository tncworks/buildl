import { getRunner, subscribe } from "@/lib/runners";

export const dynamic = "force-dynamic";

/** Server-sent events: replay the buffer, then stream live events until the runner exits. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = getRunner(id);
  if (!r) return new Response("not found", { status: 404 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      for (const e of r.events) send(e);
      if (r.stoppedAt) {
        controller.close();
        return;
      }
      const off = subscribe(id, (e) => {
        send(e);
        if (e.type === "exit") {
          off?.();
          controller.close();
        }
      });
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 15_000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ping);
        off?.();
        try { controller.close(); } catch {}
      });
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
