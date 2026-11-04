# AI Field Developer / Solutions Engineer Assessment

A compact, runnable TypeScript submission for MCP development, MCP authorization, streaming LLM safeguards, and resilient LLM routing. It intentionally keeps the downstream services injectable: each component can be evaluated locally without API keys.

## Quick start

```bash
npm install
npm test
npm run build
```

## Task 1 — custom MCP server

```bash
npm run start:mcp
```

The server uses the official `@modelcontextprotocol/sdk` with `StdioServerTransport`. It exposes `get_customer_record` and `trigger_refund`; strict Zod parsing rejects invalid arguments with a real JSON-RPC `-32602` (`Invalid Params`) response. Standard output is never written by application code—only the transport owns it. Diagnostic output uses `stderr`.

Accepted customer IDs are `CUST-` followed by exactly five upper-case letters/numbers. Refund amount must be finite, positive, and no more than 100,000; reason is trimmed and must be 10–500 characters.

## Task 2 — MCP security gateway

```bash
MCP_DOWNSTREAM_URL=http://localhost:4001/mcp npm run start:gateway
curl -s http://localhost:4000/mcp \
  -H 'content-type: application/json' -H 'authorization: Bearer local-viewer-token' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"admin_reset_key"}}'
```

`tools/list` is transparently forwarded. An `admin_*` `tools/call` is authorized before any downstream request. Local role tokens are configurable with `ADMIN_TOKEN` and `VIEWER_TOKEN`; deployments should replace this map with a verified identity-provider/JWT middleware, never a role asserted by client JSON.

## Task 3 — streaming PII guardrail

```bash
LLM_UPSTREAM_URL=http://localhost:5001/v1/chat/completions npm run start:llm
```

The proxy forwards OpenAI-style SSE deltas and applies email, SSN, and card-number redaction. It holds only a bounded look-behind tail (256 characters) to cover values split across provider chunks; it never accumulates the completion. The deliberate tiny buffering tradeoff protects PII across boundaries while preserving low memory use and near-immediate TTFT.

## Task 4 — SQLite rate limiting and fallback

`SqliteTokenRateLimiter` records per-tenant token reservations in on-disk SQLite (WAL enabled) and uses an immediate transaction to avoid concurrent over-admission. `ModelRouter` reserves estimated prompt + requested completion tokens against a 50,000-token rolling minute. A 429 or 3-second timeout falls back to the secondary provider. All other failures—and exhausted fallback—return a stable, sanitized gateway error.

Providers are passed in through the small `Provider` interface, which makes the fallback logic testable and keeps upstream vendor SDK configuration outside of policy logic.

## Submission notes

Candidate: Saigautham Ghanta (`saigautham01@gmail.com`)  
GitHub: [`cosmic-hash`](https://github.com/cosmic-hash)
