/** Task 3 — streaming SSE proxy with bounded look-behind PII redaction. */
import express, { type Request, type Response } from "express";

const PII = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b\d{3}-?\d{2}-?\d{4}\b/g,
  /\b(?:\d[ -]*?){13,19}\b/g
];

export function redact(text: string) { return PII.reduce((value, pattern) => value.replace(pattern, "[REDACTED]"), text); }

/** Holds a small tail so PII split across provider chunks is never emitted prematurely. */
export class StreamingRedactor {
  private pending = "";
  constructor(private readonly lookBehind = 256) {}
  push(delta: string): string {
    this.pending += delta;
    if (this.pending.length <= this.lookBehind) return "";
    const safe = this.pending.slice(0, -this.lookBehind);
    this.pending = this.pending.slice(-this.lookBehind);
    return redact(safe);
  }
  flush(): string { const result = redact(this.pending); this.pending = ""; return result; }
}

function sse(data: unknown) { return `data: ${JSON.stringify(data)}\n\n`; }
export function createLlmGateway(upstreamUrl = process.env.LLM_UPSTREAM_URL ?? "http://127.0.0.1:5001/v1/chat/completions") {
  const app = express(); app.use(express.json({ limit: "256kb" }));
  app.post("/v1/chat/completions", async (req: Request, res: Response) => {
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(upstreamUrl, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ ...req.body, stream: true }), signal: AbortSignal.timeout(30_000) });
    } catch { return res.status(502).json({ error: { code: "upstream_unavailable", message: "LLM provider unavailable" } }); }
    if (!upstream.ok || !upstream.body) return res.status(502).json({ error: { code: "upstream_error", message: "LLM provider rejected the request" } });
    res.status(200).set({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const decoder = new TextDecoder(); const redactor = new StreamingRedactor(); let buffer = "";
    const emitDelta = (payload: string) => {
      if (payload === "[DONE]") return;
      try {
        const event = JSON.parse(payload); const content = event.choices?.[0]?.delta?.content;
        if (typeof content === "string") { const cleaned = redactor.push(content); if (cleaned) { event.choices[0].delta.content = cleaned; res.write(sse(event)); } }
        else res.write(sse(event));
      } catch { /* malformed upstream SSE data is deliberately dropped */ }
    };
    for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) if (line.startsWith("data: ")) emitDelta(line.slice(6));
    }
    const finalText = redactor.flush();
    if (finalText) res.write(sse({ choices: [{ delta: { content: finalText } }] }));
    res.write("data: [DONE]\n\n"); res.end();
  });
  return app;
}
if (process.argv[1]?.endsWith("llm-guardrail-gateway.ts")) createLlmGateway().listen(Number(process.env.PORT ?? 5000), () => process.stderr.write("LLM guardrail gateway listening on :5000\n"));
