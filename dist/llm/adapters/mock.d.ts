import type { LlmAdapter } from "../adapter.js";
import type { ThinkOnceArgs, ThinkResult } from "../types.js";
export declare class MockAdapter implements LlmAdapter {
    readonly id = "mock";
    thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult>;
    rotateCredential(): Promise<boolean>;
}
