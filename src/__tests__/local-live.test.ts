// Live test for OpenAI-chat transport — requires MLX server running on localhost:8080
import { describe, it, expect } from "vitest";

const hasLocalServer = await fetch("http://localhost:8080/v1/models")
  .then(() => true)
  .catch(() => false);

describe.skipIf(!hasLocalServer)("OpenAI-chat transport live (MLX)", () => {
  it("makes a real call", async () => {
    const { OpenAIChatTransport } = await import("../llm/transports/openai-chat.js");
    const transport = new OpenAIChatTransport();

    const result = await transport.call({
      model: "mlx-community/Qwen3.6-35B-A3B-4bit",
      systemPrompt: "한 단어로만 대답해.",
      messages: [{ role: "user", content: "안녕?" }],
      maxTokens: 16,
      onEvent: undefined,
      config: { baseUrl: "http://localhost:8080", apiKey: "" },
    });

    console.log("  response:", result.text);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.stopReason).toBe("end_turn");
  }, 30000);

  it("streams events", async () => {
    const { OpenAIChatTransport } = await import("../llm/transports/openai-chat.js");
    const transport = new OpenAIChatTransport();
    const events: string[] = [];

    const result = await transport.call({
      model: "mlx-community/Qwen3.6-35B-A3B-4bit",
      systemPrompt: "한 단어로만 대답해.",
      messages: [{ role: "user", content: "뭐해?" }],
      maxTokens: 16,
      onEvent: (ev) => events.push(ev.type),
      config: { baseUrl: "http://localhost:8080", apiKey: "" },
    });

    console.log("  events:", events);
    console.log("  response:", result.text);
    expect(events).toContain("text_delta");
    expect(events).toContain("message_end");
  }, 30000);

  it("works through SdkAdapter", async () => {
    const { OpenAIChatTransport } = await import("../llm/transports/openai-chat.js");
    const { SdkAdapter } = await import("../llm/adapters/sdk-adapter.js");

    const adapter = new SdkAdapter({
      id: "local-test",
      transport: new OpenAIChatTransport(),
      getApiKey: async () => "",
      baseUrl: "http://localhost:8080",
    });

    const result = await adapter.thinkOnce({
      systemPrompt: "답을 숫자로만.",
      messages: [{ role: "user", content: "1+1은?" }],
      maxTokens: 8,
      model: "mlx-community/Qwen3.6-35B-A3B-4bit",
    });

    console.log("  response:", result.text);
    expect(result.text.length).toBeGreaterThan(0);
  }, 30000);
});
