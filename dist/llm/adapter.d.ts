import type { LlmProvider, ThinkOnceArgs, ThinkResult } from "./types.js";
export interface LlmAdapter {
    /** Short identifier for logging and error messages. */
    readonly id: string;
    /**
     * Execute a single LLM call. No retries — the caller (think()) handles that.
     * Throws on any error (auth, network, rate limit, etc).
     */
    thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult>;
    /**
     * Attempt to rotate credentials after an auth failure.
     * Returns true if a fresh credential is now available.
     * Adapters without rotation support return false.
     */
    rotateCredential(): Promise<boolean>;
}
export declare function resolveProviderFromModel(model: string): LlmProvider | null;
export declare class AdapterRegistry {
    private instances;
    private factories;
    /** Register a lazy factory for a provider. */
    register(provider: LlmProvider | "mock", factory: () => Promise<LlmAdapter>): void;
    /** Get an adapter instance, creating it on first access. */
    get(provider: LlmProvider | "mock"): Promise<LlmAdapter>;
    /** All registered provider keys (excluding "mock"). */
    get providers(): LlmProvider[];
}
export declare function createDefaultRegistry(): AdapterRegistry;
