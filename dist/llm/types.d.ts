export type LlmProvider = "anthropic" | "openai" | "ollama" | "vllm" | "llamacpp";
export type ToolDefinition = {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
};
export type ToolCall = {
    id: string;
    name: string;
    input: Record<string, unknown>;
};
export type ThinkResult = {
    text: string;
    toolCalls: ToolCall[];
    stopReason: string | null;
    inputTokens: number;
    outputTokens: number;
};
export type ThinkEvent = {
    type: "text_delta";
    delta: string;
} | {
    type: "tool_use_start";
    id: string;
    name: string;
} | {
    type: "tool_use_delta";
    id: string;
    partial: string;
} | {
    type: "tool_use_end";
    id: string;
} | {
    type: "message_end";
    result: ThinkResult;
};
export type ThinkEventSink = (event: ThinkEvent) => void;
export type Message = {
    role: "user";
    content: string;
} | {
    role: "assistant";
    content: Array<{
        type: "text";
        text: string;
    } | {
        type: "tool_use";
        id: string;
        name: string;
        input: unknown;
    }>;
} | {
    role: "user";
    content: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
    }>;
};
export type ThinkOnceArgs = {
    systemPrompt: string;
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
    model?: string;
    onEvent?: ThinkEventSink;
};
