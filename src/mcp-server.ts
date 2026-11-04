/** Task 1 — MCP server. stdout is owned exclusively by StdioServerTransport. */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const customerId = z.string().regex(/^CUST-[A-Z0-9]{5}$/, "Expected customer_id in CUST-XXXXX format");
const getCustomerRecord = z.object({ customer_id: customerId }).strict();
const triggerRefund = z.object({ customer_id: customerId, amount: z.number().finite().positive().max(100_000), reason: z.string().trim().min(10).max(500) }).strict();
const server = new Server({ name: "customer-operations", version: "1.0.0" }, { capabilities: { tools: {} } });
const toolDefinitions = [
  { name: "get_customer_record", description: "Retrieve a customer record by its external customer identifier.", inputSchema: { type: "object", additionalProperties: false, required: ["customer_id"], properties: { customer_id: { type: "string", pattern: "^CUST-[A-Z0-9]{5}$" } } } },
  { name: "trigger_refund", description: "Request a refund for a customer.", inputSchema: { type: "object", additionalProperties: false, required: ["customer_id", "amount", "reason"], properties: { customer_id: { type: "string", pattern: "^CUST-[A-Z0-9]{5}$" }, amount: { type: "number", exclusiveMinimum: 0, maximum: 100000 }, reason: { type: "string", minLength: 10, maxLength: 500 } } } }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_customer_record") {
    const parsed = getCustomerRecord.safeParse(request.params.arguments ?? {});
    if (!parsed.success) throw new McpError(ErrorCode.InvalidParams, parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    return { content: [{ type: "text", text: JSON.stringify({ customer_id: parsed.data.customer_id, status: "active", tier: "standard" }) }] };
  }
  if (request.params.name !== "trigger_refund") throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
  const parsed = triggerRefund.safeParse(request.params.arguments ?? {});
  if (!parsed.success) throw new McpError(ErrorCode.InvalidParams, parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { customer_id, amount, reason } = parsed.data;
  const refundId = `rfnd_${crypto.randomUUID()}`;
  process.stderr.write(`refund requested: ${refundId} for ${customer_id}\n`);
  return { content: [{ type: "text", text: JSON.stringify({ refund_id: refundId, customer_id, amount, reason, status: "pending" }) }] };
});

// Never use console.log in this process: it corrupts the newline-delimited JSON-RPC stream.
await server.connect(new StdioServerTransport());
process.stderr.write("customer-operations MCP server connected over stdio\n");
