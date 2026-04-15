import type { LlmAdapter } from "../adapter.js";
import type { ThinkOnceArgs, ThinkResult } from "../types.js";
export declare class OpenAIAdapter implements LlmAdapter {
    readonly id = "openai";
    thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult>;
    rotateCredential(): Promise<boolean>;
}
