import type { LlmProvider, ThinkOnceArgs, ThinkResult } from "./types.js";
export type { LlmProvider, Message, ToolDefinition, ToolCall, ThinkResult, ThinkEvent, ThinkEventSink, ThinkOnceArgs, } from "./types.js";
export declare function resolveProviderConfig(env?: NodeJS.ProcessEnv): {
    provider: LlmProvider;
    defaultModel: string;
    auxiliaryModel: string;
};
export declare function think(args: ThinkOnceArgs & {
    provider?: LlmProvider;
}): Promise<ThinkResult>;
export declare function thinkAux(args: ThinkOnceArgs & {
    provider?: LlmProvider;
}): Promise<ThinkResult>;
