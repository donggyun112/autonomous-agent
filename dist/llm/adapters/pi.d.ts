import type { LlmAdapter } from "../adapter.js";
import type { ThinkOnceArgs, ThinkResult } from "../types.js";
export type ApiKeyResolver = () => Promise<string>;
export interface PiAdapterConfig {
    /** Our adapter ID (e.g., "anthropic", "openai") */
    id: string;
    /** pi-ai provider name (e.g., "anthropic", "openai", "openai-codex") */
    piProvider: string;
    /** Async function to get a valid API key */
    getApiKey: ApiKeyResolver;
    /** Optional credential rotation on auth failure */
    rotateCredentialFn?: () => Promise<boolean>;
    /** Anthropic prompt cache setting */
    cacheRetention?: "none" | "short" | "long";
}
export declare class PiAdapter implements LlmAdapter {
    readonly id: string;
    private piProvider;
    private getApiKeyFn;
    private rotateCredentialFn;
    private cacheRetention;
    constructor(config: PiAdapterConfig);
    thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult>;
    rotateCredential(): Promise<boolean>;
}
