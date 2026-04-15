import { type Message } from "../llm/client.js";
export type CompactResult = {
    before: number;
    after: number;
    summarizedCount: number;
    newMessages: Message[];
};
export declare function resetCompactionState(): void;
export declare function compactIfNeeded(messages: Message[], systemPromptForContext: string, options?: {
    reservedCompletionTokens?: number;
    toolDefsTokens?: number;
}): Promise<CompactResult | null>;
