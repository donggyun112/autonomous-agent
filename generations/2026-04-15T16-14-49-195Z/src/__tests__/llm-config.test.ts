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
});
