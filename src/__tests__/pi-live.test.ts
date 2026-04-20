// Live integration test — requires OPENAI_API_KEY in .env
// Skipped automatically if no key is available.

import { describe, it, expect } from "vitest";
import { config } from "dotenv";
config();

const hasOpenAI = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasOpenAI)("OpenAI live integration", () => {
  it("makes a real OpenAI call through SdkAdapter", async () => {
    const { createDefaultRegistry } = await import("../llm/adapter.js");
    const registry = createDefaultRegistry();
    const adapter = await registry.get("openai");

    const result = await adapter.thinkOnce({
      systemPrompt: "You are a helpful assistant. Reply with exactly one word.",
      messages: [{ role: "user", content: "Say hello." }],
      maxTokens: 16,
      model: "gpt-4.1-mini",
    });

    console.log("  response:", JSON.stringify(result.text).slice(0, 100));
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.stopReason).toBe("end_turn");
  }, 30000);

  it("streams events", async () => {
    const { createDefaultRegistry } = await import("../llm/adapter.js");
    const registry = createDefaultRegistry();
    const adapter = await registry.get("openai");
    const events: string[] = [];

    const result = await adapter.thinkOnce({
      systemPrompt: "Reply with one word.",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 16,
      model: "gpt-4.1-mini",
      onEvent: (ev) => events.push(ev.type),
    });

    console.log("  events:", events);
    expect(events).toContain("text_delta");
    expect(events).toContain("message_end");
    expect(result.text.length).toBeGreaterThan(0);
  }, 30000);

  it("fallback works via think()", async () => {
    const { think } = await import("../llm/client.js");
    const result = await think({
      systemPrompt: "Reply with one word.",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 16,
      model: "gpt-4.1-mini",
    });

    console.log("  think() response:", result.text.slice(0, 50));
    expect(result.text.length).toBeGreaterThan(0);
  }, 30000);
});
