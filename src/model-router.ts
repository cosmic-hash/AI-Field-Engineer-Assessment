/** Task 4 — SQLite-backed per-tenant token limiter and resilient model routing. */
import Database from "better-sqlite3";

export type CompletionRequest = { tenantApiKey: string; model: string; prompt: string; maxTokens: number };
export type CompletionResponse = { id: string; model: string; text: string };
export type Provider = { complete(request: CompletionRequest, signal: AbortSignal): Promise<CompletionResponse> };
export type GatewayError = { error: { code: "rate_limited" | "upstream_unavailable"; message: string } };

export class SqliteTokenRateLimiter {
  private readonly db: Database.Database;
  constructor(filename = "gateway.sqlite", private readonly limit = 50_000, private readonly windowMs = 60_000) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec("CREATE TABLE IF NOT EXISTS token_events (tenant TEXT NOT NULL, occurred_at INTEGER NOT NULL, tokens INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS token_events_window ON token_events(tenant, occurred_at)");
  }
  /** A synchronous BEGIN IMMEDIATE transaction prevents concurrent processes over-admitting a tenant. */
  allow(tenant: string, tokens: number, now = Date.now()): boolean {
    if (!Number.isSafeInteger(tokens) || tokens < 1) return false;
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM token_events WHERE occurred_at < ?").run(now - this.windowMs);
      const used = (this.db.prepare("SELECT COALESCE(SUM(tokens), 0) AS total FROM token_events WHERE tenant = ? AND occurred_at >= ?").get(tenant, now - this.windowMs) as { total: number }).total;
      if (used + tokens > this.limit) return false;
      this.db.prepare("INSERT INTO token_events (tenant, occurred_at, tokens) VALUES (?, ?, ?)").run(tenant, now, tokens);
      return true;
    });
    return transaction.immediate();
  }
  close() { this.db.close(); }
}

function isFailoverWorthy(error: unknown) {
  const status = (error as { status?: number })?.status;
  return status === 429 || (error instanceof DOMException && error.name === "TimeoutError");
}
async function withTimeout(provider: Provider, request: CompletionRequest) {
  return provider.complete(request, AbortSignal.timeout(3_000));
}

export class ModelRouter {
  constructor(private readonly limiter: SqliteTokenRateLimiter, private readonly primary: Provider, private readonly secondary: Provider) {}
  async complete(request: CompletionRequest): Promise<CompletionResponse | GatewayError> {
    // Reserve the requested maximum, not just prompt tokens, so a tenant cannot exceed budget mid-generation.
    const estimatedTokens = Math.max(1, Math.ceil(request.prompt.length / 4)) + request.maxTokens;
    if (!this.limiter.allow(request.tenantApiKey, estimatedTokens)) return { error: { code: "rate_limited", message: "Tenant token budget exceeded; retry shortly." } };
    try { return await withTimeout(this.primary, request); }
    catch (error) {
      if (!isFailoverWorthy(error)) return { error: { code: "upstream_unavailable", message: "Completion service unavailable." } };
      try { return await withTimeout(this.secondary, request); }
      catch { return { error: { code: "upstream_unavailable", message: "Completion service unavailable." } }; }
    }
  }
}
