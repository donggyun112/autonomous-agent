import type { LlmAdapter } from "../adapter.js";
import type { ThinkOnceArgs, ThinkResult } from "../types.js";
export declare class AnthropicAdapter implements LlmAdapter {
    readonly id = "anthropic";
    thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult>;
    rotateCredential(): Promise<boolean>;
}
