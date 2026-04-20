// LLM Adapter interface and registry.
//
// Three providers: anthropic, openai, local.
// Each provider uses a transport (anthropic-messages or openai-chat)
// wrapped in a unified SdkAdapter.

import type { LlmProvider, ThinkOnceArgs, ThinkResult } from "./types.js";

// ── Adapter interface ──────────────────────────────────────────────────

export interface LlmAdapter {
  readonly id: string;
  thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult>;
  rotateCredential(): Promise<boolean>;
}

// ── Provider → Adapter resolution from model name ──────────────────────

export function resolveProviderFromModel(model: string): LlmProvider | null {
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  // Don't auto-route unknown models to local — let the configured default provider handle them.
  return null;
}

// ── Registry ───────────────────────────────────────────────────────────

export class AdapterRegistry {
  private instances = new Map<string, LlmAdapter>();
  private factories = new Map<string, () => Promise<LlmAdapter>>();

  register(provider: LlmProvider | "mock", factory: () => Promise<LlmAdapter>): void {
    this.factories.set(provider, factory);
  }

  async get(provider: LlmProvider | "mock"): Promise<LlmAdapter> {
    const existing = this.instances.get(provider);
    if (existing) return existing;

    const factory = this.factories.get(provider);
    if (!factory) {
      throw new Error(
        `No LLM adapter registered for provider "${provider}". ` +
        `Available: ${[...this.factories.keys()].join(", ")}`,
      );
    }

    const adapter = await factory();
    this.instances.set(provider, adapter);
    return adapter;
  }

  get providers(): LlmProvider[] {
    return [...this.factories.keys()].filter((k) => k !== "mock") as LlmProvider[];
  }
}

// ── Default registry ──────────────────────────────────────────────────

export function createDefaultRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();

  // ── Anthropic (anthropic-messages transport) ─────────────────────
  registry.register("anthropic", async () => {
    const { AnthropicTransport } = await import("./transports/anthropic.js");
    const { SdkAdapter } = await import("./adapters/sdk-adapter.js");
    const { getAuthSource } = await import("./auth/source.js");
    const source = await getAuthSource();
    return new SdkAdapter({
      id: "anthropic",
      transport: new AnthropicTransport(),
      getApiKey: () => source.getApiKey(),
      rotateCredentialFn: async () => {
        if ("rotateCredential" in source && typeof (source as Record<string, unknown>).rotateCredential === "function") {
          return await (source as { rotateCredential: () => Promise<boolean> }).rotateCredential();
        }
        return false;
      },
    });
  });

  // ── OpenAI (openai-chat transport) ──────────────────────────────
  registry.register("openai", async () => {
    const { OpenAIChatTransport } = await import("./transports/openai-chat.js");
    const { SdkAdapter } = await import("./adapters/sdk-adapter.js");
    return new SdkAdapter({
      id: "openai",
      transport: new OpenAIChatTransport(),
      getApiKey: async () => {
        // Try OAuth credentials first (pi-ai token exchange)
        try {
          const { getOAuthApiKey } = await import("@mariozechner/pi-ai/oauth") as { getOAuthApiKey: Function };
          const { loadCredentials } = await import("./auth/storage.js");
          const creds = await loadCredentials();
          if (creds.openai) {
            const result = await getOAuthApiKey("openai-codex", {
              "openai-codex": {
                access: creds.openai.access,
                refresh: creds.openai.refresh,
                expires: creds.openai.expires,
              },
            });
            if (result) {
              const { saveOpenAICredentials } = await import("./auth/storage.js");
              await saveOpenAICredentials({ ...result.newCredentials, idToken: creds.openai.idToken });
              return result.apiKey;
            }
          }
        } catch { /* fallback to env key */ }
        const key = process.env.OPENAI_API_KEY;
        if (!key) throw new Error("No OpenAI auth. Set OPENAI_API_KEY in .env.");
        return key;
      },
      baseUrl: "https://api.openai.com",
    });
  });

  // ── Local (openai-chat transport + quirks) ─────��────────────────
  const localUrl = process.env.LOCAL_LLM_URL;
  if (localUrl) {
    registry.register("local", async () => {
      const { OpenAIChatTransport } = await import("./transports/openai-chat.js");
      const { SdkAdapter } = await import("./adapters/sdk-adapter.js");
      // Register model-specific quirks
      await import("./quirks/gemma4.js");
      await import("./quirks/qwen3.js");
      return new SdkAdapter({
        id: "local",
        transport: new OpenAIChatTransport(),
        getApiKey: async () => process.env.LOCAL_LLM_API_KEY ?? "",
        baseUrl: localUrl,
        defaultSampling: {
          topK: Number(process.env.LLM_TOP_K) || 64,
          topP: Number(process.env.LLM_TOP_P) || 0.95,
          temperature: process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : undefined,
          repetitionPenalty: Number(process.env.LLM_REPETITION_PENALTY) || 1.0,
          minP: process.env.LLM_MIN_P ? Number(process.env.LLM_MIN_P) : undefined,
          presencePenalty: process.env.LLM_PRESENCE_PENALTY ? Number(process.env.LLM_PRESENCE_PENALTY) : undefined,
        },
      });
    });
  }

  // ── Mock (for testing) ──────────────────────────────────────────
  registry.register("mock", async () => {
    const { MockAdapter } = await import("./adapters/mock.js");
    return new MockAdapter();
  });

  return registry;
}
