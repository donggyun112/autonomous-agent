import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { getAuthSource } from "./auth/source.js";

config();

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-6";

// Detect whether an Anthropic credential is an OAuth access token or an API key.
// OAuth tokens issued by the Claude.ai login flow start with `sk-ant-oat`;
// API keys start with `sk-ant-api`. The distinction matters because OAuth
// tokens must be sent as Bearer authToken (not x-api-key) and require a
// specific identity in the system prompt. (pattern from pi-ai's anthropic.ts)
function isOAuthToken(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}

// Build a fresh Anthropic client for the given auth material. The SDK object
// is cheap to construct — we build a new one per request rather than caching,
// so rotated OAuth tokens take effect immediately.
function buildClient(apiKey: string): { client: Anthropic; isOAuth: boolean } {
  const oauth = isOAuthToken(apiKey);

  if (oauth) {
    return {
      client: new Anthropic({
        apiKey: null,
        authToken: apiKey,
        defaultHeaders: {
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
          "user-agent": "claude-cli/1.0",
          "x-app": "cli",
        },
      }),
      isOAuth: true,
    };
  }

  return {
    client: new Anthropic({
      apiKey,
      defaultHeaders: {
        "anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
      },
    }),
    isOAuth: false,
  };
}

// OAuth tokens require the first system text block to be Claude Code's
// identity. This is a constraint set by Anthropic's OAuth server — requests
// without this identity are rejected. We keep our real system prompt in a
// second block. (pattern from pi-ai's buildParams)
const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

function buildSystem(isOAuth: boolean, systemPrompt: string): Anthropic.TextBlockParam[] | string {
  if (!isOAuth) return systemPrompt;
  return [
    { type: "text", text: CLAUDE_CODE_IDENTITY },
    { type: "text", text: systemPrompt },
  ];
}

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

export async function think(args: {
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  model?: string;
  onEvent?: ThinkEventSink;
}): Promise<ThinkResult> {
  const source = await getAuthSource();
  const apiKey = await source.getApiKey();
  const { client, isOAuth } = buildClient(apiKey);

  const stream = client.messages.stream({
    model: args.model ?? DEFAULT_MODEL,
    max_tokens: args.maxTokens ?? 4096,
    system: buildSystem(isOAuth, args.systemPrompt),
    messages: args.messages as Anthropic.MessageParam[],
    tools: args.tools as Anthropic.Tool[] | undefined,
  });

  // Subscribe to streaming events for callers that want progress.
  if (args.onEvent) {
    stream.on("text", (delta) => {
      args.onEvent!({ type: "text_delta", delta });
    });
    stream.on("contentBlock", (block) => {
      if (block.type === "tool_use") {
        args.onEvent!({ type: "tool_use_end", id: block.id });
      }
    });
  }

  const response = await stream.finalMessage();

  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  const result: ThinkResult = {
    text,
    toolCalls,
    stopReason: response.stop_reason,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  if (args.onEvent) {
    args.onEvent({ type: "message_end", result });
  }

  return result;
}
