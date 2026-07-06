import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProviderFromModel, createDefaultRegistry } from "../llm/adapter.js";

describe("resolveProviderFromModel", () => {
  it("resolves claude → anthropic", () => {
    expect(resolveProviderFromModel("claude-opus-4-6")).toBe("anthropic");
    expect(resolveProviderFromModel("claude-sonnet-4-20250514")).toBe("anthropic");
  });
  it("resolves gpt/o1/o3 → openai", () => {
    expect(resolveProviderFromModel("gpt-5.4-mini")).toBe("openai");
    expect(resolveProviderFromModel("o1-preview")).toBe("openai");
    expect(resolveProviderFromModel("o3-mini")).toBe("openai");
  });
  it("returns null for unknown models (let default provider handle)", () => {
    expect(resolveProviderFromModel("some-local-model")).toBeNull();
    expect(resolveProviderFromModel("custom-model")).toBeNull();
  });
  it("resolves routed gateway model IDs → cline", () => {
    expect(resolveProviderFromModel("zai/glm-5.2")).toBe("cline");
    expect(resolveProviderFromModel("anthropic/claude-sonnet-4-20250514")).toBe("cline");
  });
});

describe("mock adapter via registry", () => {
  it("returns scripted response with tool calls", async () => {
    const registry = createDefaultRegistry();
    const adapter = await registry.get("mock");
    expect(adapter.id).toBe("mock");

    const result = await adapter.thinkOnce({
      systemPrompt: "test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.text).toContain("mock self-test");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("transition");
    expect(result.toolCalls[0].input).toEqual({ to: "SLEEP", reason: "self-test complete" });
    expect(result.stopReason).toBe("tool_use");
  });

  it("emits streaming events", async () => {
    const registry = createDefaultRegistry();
    const adapter = await registry.get("mock");
    const events: string[] = [];

    await adapter.thinkOnce({
      systemPrompt: "test",
      messages: [{ role: "user", content: "hello" }],
      onEvent: (ev) => events.push(ev.type),
    });

    expect(events).toContain("text_delta");
    expect(events).toContain("message_end");
  });
});

describe("think() with mock", () => {
  beforeEach(() => { process.env.SELF_TEST_MOCK_LLM = "1"; });
  afterEach(() => { delete process.env.SELF_TEST_MOCK_LLM; });

  it("routes to mock adapter and returns tool calls", async () => {
    const { think } = await import("../llm/client.js");
    const result = await think({
      systemPrompt: "test",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("transition");
    expect(result.stopReason).toBe("tool_use");
  });
});

describe("registry providers", () => {
  it("lists configured providers and omits mock", () => {
    const saved = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      local: process.env.LOCAL_LLM_URL,
      clineEnabled: process.env.CLINE_ENABLED,
    };
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.LOCAL_LLM_URL = "http://localhost:8080";
    process.env.CLINE_ENABLED = "1";

    const registry = createDefaultRegistry();
    const providers = registry.providers;
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("local");
    expect(providers).toContain("cline");
    expect(providers).not.toContain("mock");

    if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.anthropic;
    if (saved.openai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.openai;
    if (saved.local === undefined) delete process.env.LOCAL_LLM_URL;
    else process.env.LOCAL_LLM_URL = saved.local;
    if (saved.clineEnabled === undefined) delete process.env.CLINE_ENABLED;
    else process.env.CLINE_ENABLED = saved.clineEnabled;
  });
});
