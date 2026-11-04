/** Task 2 — HTTP JSON-RPC policy enforcement in front of an MCP server. */
import express, { type Request, type Response } from "express";

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: { name?: string } };
type Role = "admin" | "viewer";
const roleByToken: Record<string, Role> = {
  [process.env.ADMIN_TOKEN ?? "local-admin-token"]: "admin",
  [process.env.VIEWER_TOKEN ?? "local-viewer-token"]: "viewer"
};

export function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function roleFrom(req: Request): Role | undefined {
  const value = req.header("authorization");
  const match = value?.match(/^Bearer ([^\s]+)$/i);
  return match ? roleByToken[match[1]] : undefined;
}

export function createMcpGateway(downstreamUrl = process.env.MCP_DOWNSTREAM_URL ?? "http://127.0.0.1:4001/mcp") {
  const app = express();
  app.use(express.json({ limit: "256kb", type: "application/json" }));
  app.post("/mcp", async (req: Request, res: Response) => {
    const body = req.body as JsonRpcRequest;
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return res.status(400).json(jsonRpcError(body?.id, -32600, "Invalid Request"));
    }
    if (body.method === "tools/call" && typeof body.params?.name === "string" && body.params.name.startsWith("admin_")) {
      if (roleFrom(req) !== "admin") return res.status(403).json(jsonRpcError(body.id, -32001, "Unauthorized Tool Call"));
    }
    try {
      const upstream = await fetch(downstreamUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: req.header("accept") ?? "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10_000)
      });
      const text = await upstream.text();
      res.status(upstream.status).type(upstream.headers.get("content-type") ?? "application/json").send(text);
    } catch {
      res.status(502).json(jsonRpcError(body.id, -32000, "Downstream MCP unavailable"));
    }
  });
  return app;
}

if (process.argv[1]?.endsWith("mcp-security-gateway.ts")) {
  createMcpGateway().listen(Number(process.env.PORT ?? 4000), () => process.stderr.write("MCP gateway listening on :4000\n"));
}
