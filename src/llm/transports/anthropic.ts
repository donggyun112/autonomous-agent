// Anthropic Messages API transport.
//
// Uses @anthropic-ai/sdk for native Anthropic API support.
// Handles streaming, tool use, and prompt caching.

import type { LlmTransport, TransportCallArgs } from "./types.js";
import type { Message, ToolCall, ThinkResult } from "../types.js";

// OAuth tokens from Anthropic's OAuth server require this identity prefix.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

// ── Message conversion (ours → Anthropic Messages format) ──────────────

function toAnthropicMessages(messages: Message[]): unknown[] {
  const out: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      // Already in Anthropic's native format (text + tool_use blocks)
      out.push({
        role: "assistant",
        content: msg.content.map((block) => {
          if (block.type === "text") return { type: "text", text: (block as { text: string }).text };
          if (block.type === "tool_use") {
            const tu = block as { id: string; name: string; input: unknown };
            return { type: "tool_use", id: tu.id, name: tu.name, input: tu.input };
          }
          return block;
        }),
      });
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      out.push({
        role: "user",
        content: msg.content.map((block) => {
          if ((block as { type: string }).type === "tool_result") {
            const tr = block as { tool_use_id: string; content: string };
            return { type: "tool_result", tool_use_id: tr.tool_use_id, content: tr.content };
          }
          return block;
        }),
      });
    }
  }
  return out;
}

function toAnthropicTools(tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>) {
  return tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

// ── Transport ──────────────────────────────────────────────────────────

export class AnthropicTransport implements LlmTransport {
  readonly protocol = "anthropic-messages" as const;

  async call(args: TransportCallArgs): Promise<ThinkResult> {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;

    const isOAuthToken = args.config.apiKey.startsWith("sk-ant-oat") ||
                         args.config.apiKey.startsWith("eyJ");

    const client = new Anthropic({
      apiKey: isOAuthToken ? undefined : args.config.apiKey,
      authToken: isOAuthToken ? args.config.apiKey : undefined,
      ...(args.config.baseUrl ? { baseURL: args.config.baseUrl } : {}),
    });

    // OAuth tokens require the Claude Code identity prefix
    let systemPrompt = args.systemPrompt;
    if (isOAuthToken) {
      systemPrompt = CLAUDE_CODE_IDENTITY + "\n\n" + systemPrompt;
    }

    const tools = toAnthropicTools(args.tools);
    const requestBody: Record<string, unknown> = {
      model: args.model,
      max_tokens: args.maxTokens,
      system: systemPrompt,
      messages: toAnthropicMessages(args.messages),
    };
    if (tools && tools.length > 0) requestBody.tools = tools;

    // Streaming — use raw events for correct tool_use ordering.
    // content_block_start fires BEFORE input_json_delta, and
    // content_block_stop fires AFTER. The high-level helpers
    // (contentBlock, inputJson) don't guarantee this order.
    const stream = client.messages.stream(requestBody as Parameters<typeof client.messages.stream>[0]);

    let text = "";
    const toolCalls: ToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    // Track tool blocks by index for multi-tool support
    const toolBlockIds: Record<number, { id: string; name: string }> = {};

    stream.on("streamEvent", (event: Record<string, unknown>) => {
      const type = event.type as string;

      if (type === "content_block_start") {
        const block = (event as { content_block?: Record<string, unknown> }).content_block;
        if (block?.type === "tool_use") {
          const idx = (event as { index?: number }).index ?? 0;
          const id = block.id as string;
          const name = block.name as string;
          toolBlockIds[idx] = { id, name };
          args.onEvent?.({ type: "tool_use_start", id, name });
        }
      }

      if (type === "content_block_delta") {
        const delta = (event as { delta?: Record<string, unknown> }).delta;
        const idx = (event as { index?: number }).index ?? 0;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          text += delta.text;
          args.onEvent?.({ type: "text_delta", delta: delta.text });
        }
        if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const tool = toolBlockIds[idx];
          if (tool) {
            args.onEvent?.({ type: "tool_use_delta", id: tool.id, partial: delta.partial_json });
          }
        }
      }

      if (type === "content_block_stop") {
        const idx = (event as { index?: number }).index ?? 0;
        const tool = toolBlockIds[idx];
        if (tool) {
          args.onEvent?.({ type: "tool_use_end", id: tool.id });
        }
      }

      if (type === "message_delta") {
        const usage = (event as { usage?: Record<string, number> }).usage;
        if (usage?.output_tokens) outputTokens = usage.output_tokens;
      }
    });

    const message = await stream.finalMessage();

    inputTokens = message.usage?.input_tokens ?? 0;
    outputTokens = message.usage?.output_tokens ?? 0;

    // Extract from final message
    text = "";
    for (const block of message.content) {
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
      stopReason: message.stop_reason === "tool_use" ? "tool_use" : "end_turn",
      inputTokens,
      outputTokens,
    };
    args.onEvent?.({ type: "message_end", result });
    return result;
  }
}
