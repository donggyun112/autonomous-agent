// LLM Adapter interface and registry.
//
// Every provider (Anthropic, OpenAI, Ollama, …) implements LlmAdapter.
// The AdapterRegistry lazily instantiates adapters on first use so that
// heavy SDK imports (e.g. openai) only happen when actually needed.
// ── Provider → Adapter resolution from model name ──────────────────────
export function resolveProviderFromModel(model) {
    if (model.startsWith("claude-"))
        return "anthropic";
    if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3"))
        return "openai";
    if (model.startsWith("ollama/"))
        return "ollama";
    if (model.startsWith("local/")) {
        return (process.env.LOCAL_LLM_PROVIDER ?? "ollama");
    }
    return null;
}
// ── Registry ───────────────────────────────────────────────────────────
export class AdapterRegistry {
    instances = new Map();
    factories = new Map();
    /** Register a lazy factory for a provider. */
    register(provider, factory) {
        this.factories.set(provider, factory);
    }
    /** Get an adapter instance, creating it on first access. */
    async get(provider) {
        const existing = this.instances.get(provider);
        if (existing)
            return existing;
        const factory = this.factories.get(provider);
        if (!factory) {
            throw new Error(`No LLM adapter registered for provider "${provider}". ` +
                `Available: ${[...this.factories.keys()].join(", ")}`);
        }
        const adapter = await factory();
        this.instances.set(provider, adapter);
        return adapter;
    }
    /** All registered provider keys (excluding "mock"). */
    get providers() {
        return [...this.factories.keys()].filter((k) => k !== "mock");
    }
}
// ── Default registry with built-in adapters ────────────────────────────
export function createDefaultRegistry() {
    const registry = new AdapterRegistry();
    registry.register("anthropic", async () => {
        const { PiAdapter } = await import("./adapters/pi.js");
        const { getAuthSource } = await import("./auth/source.js");
        const source = await getAuthSource();
        return new PiAdapter({
            id: "anthropic",
            piProvider: "anthropic",
            getApiKey: () => source.getApiKey(),
            rotateCredentialFn: async () => {
                if ("rotateCredential" in source && typeof source.rotateCredential === "function") {
                    return await source.rotateCredential();
                }
                return false;
            },
            cacheRetention: "long",
        });
    });
    registry.register("openai", async () => {
        const { PiAdapter } = await import("./adapters/pi.js");
        return new PiAdapter({
            id: "openai",
            piProvider: "openai",
            getApiKey: async () => {
                try {
                    // @ts-ignore — pi-ai oauth module for token exchange
                    const { getOAuthApiKey } = await import("@mariozechner/pi-ai/oauth");
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
                }
                catch { /* fallback to env key */ }
                const key = process.env.OPENAI_API_KEY;
                if (!key)
                    throw new Error("No OpenAI auth available. Set OPENAI_API_KEY in .env.");
                return key;
            },
        });
    });
    // Local model servers (MLX, llama.cpp, vLLM, etc.)
    // Activated by env: LOCAL_LLM_URL=http://localhost:8080
    const localUrl = process.env.LOCAL_LLM_URL;
    if (localUrl) {
        const localModel = process.env.LOCAL_LLM_MODEL ?? "default";
        // Register as the provider matching LlmProvider type (default: "ollama")
        const localProvider = (process.env.LOCAL_LLM_PROVIDER ?? "ollama");
        registry.register(localProvider, async () => {
            const { LocalAdapter } = await import("./adapters/local.js");
            return new LocalAdapter({
                id: localProvider,
                baseUrl: localUrl,
                defaultModel: localModel,
            });
        });
    }
    registry.register("mock", async () => {
        const { MockAdapter } = await import("./adapters/mock.js");
        return new MockAdapter();
    });
    return registry;
}
//# sourceMappingURL=adapter.js.map