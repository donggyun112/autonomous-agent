// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// The inner-voice layer. The agent's think() entry point. OAuth and API key
// detection, system prompt construction, header injection all live here.
// Wrong changes here are very hard to recover from — the agent loses speech.
// Must go through molt.
// ===========================================================================

import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { getAuthSource } from "./auth/source.js";
import { classifyError } from "../core/errors.js";
import { logSystem } from "../core/system-log.js";

config();

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-6";
const AUXILIARY_MODEL = process.env.AUXILIARY_MODEL ?? "claude-sonnet-4-20250514";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

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

// Self-test mock: when SELF_TEST_MOCK_LLM=1, think() never touches the
// network. It returns a scripted response that uses transition to SLEEP —
// this exercises the full cycle machinery (message construction, tool
// dispatch, state update, loop exit) without burning tokens or requiring
// an API key. The molt protocol runs this inside the candidate container
// to verify the new shell can actually live before we swap into it.
async function mockThink(args: {
  onEvent?: ThinkEventSink;
}): Promise<ThinkResult> {
  const result: ThinkResult = {
    text: "(mock self-test thought — the shell is alive)",
    toolCalls: [
      {
        id: "mock_t1",
        name: "transition",
        input: { to: "SLEEP", reason: "self-test complete" },
      },
    ],
    stopReason: "tool_use",
    inputTokens: 0,
    outputTokens: 0,
  };
  if (args.onEvent) {
    args.onEvent({ type: "text_delta", delta: result.text });
    args.onEvent({ type: "message_end", result });
  }
  return result;
}

// Internal: perform a single LLM request (no retry). Extracted so that the
// retry wrapper can call it cleanly.
async function thinkOnce(args: {
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

// Sleep helper for exponential backoff.
function backoffMs(attempt: number): number {
  const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  // Add jitter: +-25% to avoid thundering herd.
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function think(args: {
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  model?: string;
  onEvent?: ThinkEventSink;
}): Promise<ThinkResult> {
  if (process.env.SELF_TEST_MOCK_LLM === "1") {
    return mockThink({ onEvent: args.onEvent });
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const start = Date.now();
      const result = await thinkOnce(args);
      const durationMs = Date.now() - start;
      try {
        await logSystem({
          ts: new Date().toISOString(),
          event: "llm_call",
          model: args.model ?? DEFAULT_MODEL,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs,
        });
      } catch {
        // logging must never crash the caller
      }
      return result;
    } catch (err: unknown) {
      lastError = err;
      const classified = classifyError(err);

      // Auth errors: try rotating credentials before retrying.
      if (classified.category === "auth" && classified.recovery.should_rotate_credential) {
        const source = await getAuthSource();
        if ("rotateCredential" in source && typeof (source as Record<string, unknown>).rotateCredential === "function") {
          const rotated = await (source as { rotateCredential: () => Promise<boolean> }).rotateCredential();
          if (rotated && attempt < MAX_RETRIES) {
            continue; // retry immediately with the new key
          }
        }
      }

      // Only retry on retryable errors (rate_limit, network).
      if (!classified.recovery.retryable || attempt >= MAX_RETRIES) {
        throw err;
      }

      const delay = backoffMs(attempt);
      await sleep(delay);
    }
  }

  // Should be unreachable, but satisfies the compiler.
  throw lastError;
}

// Auxiliary model variant of think(). Same signature but defaults to a cheaper
// model (AUXILIARY_MODEL env var, fallback claude-sonnet-4-20250514). Use this for
// non-critical operations like sleep consolidation where Opus-level reasoning
// is unnecessary.
export async function thinkAux(args: {
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  model?: string;
  onEvent?: ThinkEventSink;
}): Promise<ThinkResult> {
  return think({
    ...args,
    model: args.model ?? AUXILIARY_MODEL,
  });
}
