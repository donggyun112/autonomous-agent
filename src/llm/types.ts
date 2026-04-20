// Shared type definitions for the LLM layer.
//
// All adapters, the client entry point, and consumers import from here.
// Keeping types in one place prevents circular dependencies between
// adapter implementations and the client module.

export type LlmProvider = "anthropic" | "openai" | "local";

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
  /** Raw reasoning/thinking content from the model (if any). */
  reasoning?: string;
};

// Streaming events emitted while the LLM produces a response.
// Callers can subscribe to see thoughts emerge in real time — important for
// daemon mode where a single turn might take 30+ seconds.
export type ThinkEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; partial: string }
  | { type: "tool_use_end"; id: string }
  | { type: "message_end"; result: ThinkResult };

export type ThinkEventSink = (event: ThinkEvent) => void;

export type Message =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      >;
    }
  | {
      role: "user";
      content: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
      }>;
    };

// Arguments shared by all adapter thinkOnce() calls.
export type ThinkOnceArgs = {
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  model?: string;
  onEvent?: ThinkEventSink;
};

// ── Transport & Model metadata ────────────────────────────────────────

/** Wire protocol for LLM API calls. */
export type Transport = "anthropic-messages" | "openai-chat";

/** Sampling parameters passed to the LLM. */
export type SamplingParams = {
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  repetitionPenalty?: number;
  presencePenalty?: number;
};

/** Per-model metadata. Used to select transport and apply quirks. */
export type ModelMeta = {
  id: string;
  transport: Transport;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsThinking?: boolean;
  defaultSampling?: SamplingParams;
  /** Quirk IDs to apply when parsing tool calls from text. */
  quirks?: string[];
};
