// Unified LLM adapter using @mariozechner/pi-ai.
//
// A single adapter class handles all providers (Anthropic, OpenAI, …)
// through pi-ai's getModel() + streamSimple(). Provider-specific details
// (auth, caching, OAuth identity) are injected via PiAdapterConfig.

import type { LlmAdapter } from "../adapter.js";
import type {
  Message,
  ThinkOnceArgs,
  ThinkResult,
  ToolCall,
  ThinkEventSink,
} from "../types.js";

// ── Config ─────────────────────────────────────────────────────────────

export type ApiKeyResolver = () => Promise<string>;

export interface PiAdapterConfig {
  /** Our adapter ID (e.g., "anthropic", "openai") */
  id: string;
  /** pi-ai provider name (e.g., "anthropic", "openai", "openai-codex") */
  piProvider: string;
  /** Async function to get a valid API key */
  getApiKey: ApiKeyResolver;
  /** Optional credential rotation on auth failure */
  rotateCredentialFn?: () => Promise<boolean>;
  /** Anthropic prompt cache setting */
  cacheRetention?: "none" | "short" | "long";
}

// OAuth tokens from Anthropic's OAuth server require this identity prefix.
const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

// ── Message format conversion (ours → pi-ai) ──────────────────────────

function toPiMessages(messages: Message[]): unknown[] {
  const out: unknown[] = [];
  // Track last assistant blocks to look up toolName for tool_result
  let lastAssistantBlocks: Array<{
    type: string;
    id?: string;
    name?: string;
  }> = [];

  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content, timestamp: Date.now() });
      lastAssistantBlocks = [];
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      lastAssistantBlocks = msg.content as typeof lastAssistantBlocks;
      const content = msg.content.map((block) => {
        if (block.type === "text") {
          return { type: "text", text: (block as { text: string }).text };
        }
        if (block.type === "tool_use") {
          const tu = block as { id: string; name: string; input: unknown };
          return {
            type: "toolCall",
            id: tu.id,
            name: tu.name,
            arguments: tu.input,
          };
        }
        return block;
      });
      const hasToolCall = content.some(
        (b: Record<string, unknown>) => b.type === "toolCall",
      );
      out.push({
        role: "assistant",
        content,
        timestamp: Date.now(),
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: hasToolCall ? "toolUse" : "stop",
        model: "",
        api: "",
        provider: "",
      });
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      // tool_result blocks → individual pi-ai ToolResultMessage
      for (const block of msg.content) {
        if ((block as { type: string }).type === "tool_result") {
          const tr = block as { tool_use_id: string; content: string };
          const match = lastAssistantBlocks.find(
            (b) => b.type === "tool_use" && b.id === tr.tool_use_id,
          );
          out.push({
            role: "toolResult",
            toolCallId: tr.tool_use_id,
            toolName: match?.name ?? "",
            content: [{ type: "text", text: tr.content }],
            isError: false,
            timestamp: Date.now(),
          });
        }
      }
    }
  }
  return out;
}

// ── Stream collection (pi-ai events → our ThinkResult) ────────────────

async function collectStream(
  stream: AsyncIterable<Record<string, unknown>>,
  onEvent?: ThinkEventSink,
): Promise<ThinkResult> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;

  for await (const ev of stream) {
    switch (ev.type) {
      case "text_delta":
        text += ev.delta;
        onEvent?.({ type: "text_delta", delta: ev.delta as string });
        break;

      case "toolcall_start": {
        const partial = ev.partial as Record<string, unknown> | undefined;
        const content = partial?.content as Array<Record<string, unknown>> | undefined;
        const tc = content?.[ev.contentIndex as number];
        if (tc) {
          onEvent?.({
            type: "tool_use_start",
            id: (tc.id as string) ?? "",
            name: (tc.name as string) ?? "",
          });
        }
        break;
      }

      case "toolcall_delta": {
        const partial = ev.partial as Record<string, unknown> | undefined;
        const content = partial?.content as Array<Record<string, unknown>> | undefined;
        const tc = content?.[ev.contentIndex as number];
        onEvent?.({
          type: "tool_use_delta",
          id: (tc?.id as string) ?? "",
          partial: ev.delta as string,
        });
        break;
      }

      case "toolcall_end": {
        const tc = ev.toolCall as {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
        onEvent?.({ type: "tool_use_end", id: tc.id });
        toolCalls.push({ id: tc.id, name: tc.name, input: tc.arguments ?? {} });
        break;
      }

      case "done": {
        const reason = ev.reason as string | undefined;
        stopReason = reason === "toolUse" ? "tool_use" : "end_turn";
        const msg = ev.message as Record<string, unknown> | undefined;
        const usage = msg?.usage as Record<string, number> | undefined;
        if (usage) {
          inputTokens = usage.inputTokens ?? 0;
          outputTokens = usage.outputTokens ?? 0;
        }
        // Collect text from final message if streaming missed any
        if (!text) {
          const blocks = msg?.content as Array<Record<string, unknown>> | undefined;
          if (blocks) {
            for (const block of blocks) {
              if (block.type === "text") text += block.text as string;
            }
          }
        }
        break;
      }

      case "error": {
        const errMsg = ev.error as Record<string, unknown> | undefined;
        throw new Error(
          (errMsg?.errorMessage as string) ?? "LLM stream error",
        );
      }
    }
  }

  const result: ThinkResult = {
    text,
    toolCalls,
    stopReason,
    inputTokens,
    outputTokens,
  };
  onEvent?.({ type: "message_end", result });
  return result;
}

// ── Adapter ────────────────────────────────────────────────────────────

export class PiAdapter implements LlmAdapter {
  readonly id: string;
  private piProvider: string;
  private getApiKeyFn: ApiKeyResolver;
  private rotateCredentialFn: (() => Promise<boolean>) | undefined;
  private cacheRetention: "none" | "short" | "long" | undefined;

  constructor(config: PiAdapterConfig) {
    this.id = config.id;
    this.piProvider = config.piProvider;
    this.getApiKeyFn = config.getApiKey;
    this.rotateCredentialFn = config.rotateCredentialFn;
    this.cacheRetention = config.cacheRetention;
  }

  async thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult> {
    // Dynamic import — heavy SDK only loaded when actually used.
    const { getModel, streamSimple } = await import("@mariozechner/pi-ai");

    const apiKey = await this.getApiKeyFn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = getModel(this.piProvider as any, args.model as any);

    // Anthropic OAuth tokens require Claude Code identity in system prompt.
    let systemPrompt = args.systemPrompt;
    if (this.piProvider === "anthropic" && apiKey.includes("sk-ant-oat")) {
      systemPrompt = CLAUDE_CODE_IDENTITY + "\n\n" + systemPrompt;
    }

    const context = {
      systemPrompt,
      messages: toPiMessages(args.messages),
      tools: args.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = streamSimple(model, context as any, {
      apiKey,
      maxTokens: args.maxTokens ?? 4096,
      ...(this.cacheRetention ? { cacheRetention: this.cacheRetention } : {}),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return collectStream(stream as any, args.onEvent);
  }

  async rotateCredential(): Promise<boolean> {
    return this.rotateCredentialFn?.() ?? false;
  }
}
