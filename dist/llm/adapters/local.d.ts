import type { LlmAdapter } from "../adapter.js";
import type { ThinkOnceArgs, ThinkResult } from "../types.js";
export interface LocalAdapterConfig {
    /** Adapter ID for logging (e.g., "mlx", "llamacpp") */
    id: string;
    /** Base URL of the local server (e.g., "http://localhost:8080") */
    baseUrl: string;
    /** Default model name to pass to the server */
    defaultModel?: string;
}
export declare class LocalAdapter implements LlmAdapter {
    readonly id: string;
    private baseUrl;
    private defaultModel;
    constructor(config: LocalAdapterConfig);
    thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult>;
    rotateCredential(): Promise<boolean>;
}
