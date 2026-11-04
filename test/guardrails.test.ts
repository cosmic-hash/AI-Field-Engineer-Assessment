import { describe, expect, it } from "vitest";
import { StreamingRedactor, redact } from "../src/llm-guardrail-gateway.js";
import { jsonRpcError } from "../src/mcp-security-gateway.js";

describe("streaming redaction", () => {
  it("redacts common PII", () => expect(redact("mail a@b.com, SSN 123-45-6789")).toBe("mail [REDACTED], SSN [REDACTED]"));
  it("withholds a tail across chunk boundaries", () => {
    const guard = new StreamingRedactor();
    expect(guard.push("reach jane@")).toBe("");
    expect(guard.push("example.com now")).toBe("");
    expect(guard.flush()).toBe("reach [REDACTED] now");
  });
});
describe("JSON-RPC errors", () => {
  it("preserves id and standard gateway code", () => expect(jsonRpcError(7, -32001, "Unauthorized Tool Call")).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32001, message: "Unauthorized Tool Call" } }));
});
