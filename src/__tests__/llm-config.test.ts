import { describe, expect, it } from "vitest";
import { resolveProviderConfig } from "../llm/client.js";

describe("resolveProviderConfig", () => {
  it("uses OpenAI defaults when AGENT_LLM=openai", () => {
    const config = resolveProviderConfig({
      AGENT_LLM: "openai",
      OPENAI_MODEL: "gpt-5.4-mini",
      OPENAI_AUXILIARY_MODEL: "gpt-5.4-nano",
    });

    expect(config.provider).toBe("openai");
    expect(config.defaultModel).toBe("gpt-5.4-mini");
    expect(config.auxiliaryModel).toBe("gpt-5.4-nano");
  });

  it("ignores blank generic overrides", () => {
    const config = resolveProviderConfig({
      AGENT_LLM: "openai",
      AGENT_MODEL: "   ",
      AUXILIARY_MODEL: "",
    });

    expect(config.defaultModel).toBe("gpt-5.4-mini");
    expect(config.auxiliaryModel).toBe("gpt-5.4-nano");
  });

  it("uses Anthropic defaults when provider is unset", () => {
    const config = resolveProviderConfig({});

    expect(config.provider).toBe("anthropic");
    expect(config.defaultModel).toBe("claude-opus-4-6");
    expect(config.auxiliaryModel).toBe("claude-sonnet-4-20250514");
  });

  it("uses local when AGENT_LLM=local", () => {
    const config = resolveProviderConfig({
      AGENT_LLM: "local",
      LOCAL_LLM_MODEL: "mlx-community/Qwen3.6-35B-A3B-4bit",
    });

    expect(config.provider).toBe("local");
    expect(config.defaultModel).toBe("mlx-community/Qwen3.6-35B-A3B-4bit");
  });

  it("maps ollama to local for backwards compat", () => {
    const config = resolveProviderConfig({
      AGENT_LLM: "ollama",
      LOCAL_LLM_MODEL: "some-model",
    });

    expect(config.provider).toBe("local");
  });

  it("auto-detects local when LOCAL_LLM_URL is set without AGENT_LLM", () => {
    const config = resolveProviderConfig({
      LOCAL_LLM_URL: "http://localhost:8080",
      LOCAL_LLM_MODEL: "some-model",
    });

    expect(config.provider).toBe("local");
    expect(config.defaultModel).toBe("some-model");
  });
});
