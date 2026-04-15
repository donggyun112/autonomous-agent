// Live test for LocalAdapter — requires MLX server running on localhost:8080
import { describe, it, expect } from "vitest";

const hasLocalServer = await fetch("http://localhost:8080/v1/models")
  .then(() => true)
  .catch(() => false);

describe.skipIf(!hasLocalServer)("LocalAdapter live (MLX)", () => {
  it("makes a real call through LocalAdapter", async () => {
    const { LocalAdapter } = await import("../llm/adapters/local.js");
    const adapter = new LocalAdapter({
      id: "mlx",
      baseUrl: "http://localhost:8080",
      defaultModel: "Jiunsong/supergemma4-26b-abliterated-multimodal-mlx-4bit",
    });

    const result = await adapter.thinkOnce({
      systemPrompt: "한 단어로만 대답해.",
      messages: [{ role: "user", content: "안녕?" }],
      maxTokens: 16,
    });

    console.log("  response:", result.text);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.stopReason).toBe("end_turn");
  }, 30000);

  it("streams events", async () => {
    const { LocalAdapter } = await import("../llm/adapters/local.js");
    const adapter = new LocalAdapter({
      id: "mlx",
      baseUrl: "http://localhost:8080",
      defaultModel: "Jiunsong/supergemma4-26b-abliterated-multimodal-mlx-4bit",
    });
    const events: string[] = [];

    const result = await adapter.thinkOnce({
      systemPrompt: "한 단어로만 대답해.",
      messages: [{ role: "user", content: "뭐해?" }],
      maxTokens: 16,
      onEvent: (ev) => events.push(ev.type),
    });

    console.log("  events:", events);
    console.log("  response:", result.text);
    expect(events).toContain("text_delta");
    expect(events).toContain("message_end");
  }, 30000);

  it("works through think() with fallback chain", async () => {
    // Temporarily set env for local provider
    const prev = { ...process.env };
    process.env.LOCAL_LLM_URL = "http://localhost:8080";
    process.env.LOCAL_LLM_MODEL = "Jiunsong/supergemma4-26b-abliterated-multimodal-mlx-4bit";
    process.env.LOCAL_LLM_PROVIDER = "ollama";

    try {
      // Direct import to get fresh module with env
      const { LocalAdapter } = await import("../llm/adapters/local.js");
      const adapter = new LocalAdapter({
        id: "mlx",
        baseUrl: "http://localhost:8080",
        defaultModel: "Jiunsong/supergemma4-26b-abliterated-multimodal-mlx-4bit",
      });

      const result = await adapter.thinkOnce({
        systemPrompt: "답을 숫자로만.",
        messages: [{ role: "user", content: "1+1은?" }],
        maxTokens: 8,
      });

      console.log("  think() response:", result.text);
      expect(result.text.length).toBeGreaterThan(0);
    } finally {
      Object.assign(process.env, prev);
    }
  }, 30000);
});
