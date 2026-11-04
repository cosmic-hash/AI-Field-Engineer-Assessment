import { describe, expect, it } from "vitest";
import { ModelRouter, SqliteTokenRateLimiter, type Provider } from "../src/model-router.js";

const reply = { id: "cmpl_1", model: "primary", text: "ok" };
const successful: Provider = { complete: async () => reply };
describe("SqliteTokenRateLimiter", () => {
  it("counts tokens inside the rolling minute", () => {
    const limiter = new SqliteTokenRateLimiter(":memory:", 10, 60_000);
    expect(limiter.allow("tenant", 6, 100)).toBe(true);
    expect(limiter.allow("tenant", 5, 101)).toBe(false);
    expect(limiter.allow("tenant", 5, 60_101)).toBe(true);
  });
});
describe("ModelRouter", () => {
  it("fails over only on 429", async () => {
    const primary: Provider = { complete: async () => { throw Object.assign(new Error("busy"), { status: 429 }); } };
    const router = new ModelRouter(new SqliteTokenRateLimiter(":memory:", 1000), primary, successful);
    await expect(router.complete({ tenantApiKey: "t", model: "x", prompt: "hello", maxTokens: 5 })).resolves.toEqual(reply);
  });
  it("sanitizes unexpected provider errors", async () => {
    const broken: Provider = { complete: async () => { throw new Error("secret stack trace"); } };
    const router = new ModelRouter(new SqliteTokenRateLimiter(":memory:", 1000), broken, successful);
    await expect(router.complete({ tenantApiKey: "t", model: "x", prompt: "hello", maxTokens: 5 })).resolves.toEqual({ error: { code: "upstream_unavailable", message: "Completion service unavailable." } });
  });
});
