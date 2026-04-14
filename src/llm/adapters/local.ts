// Local LLM adapter for OpenAI-compatible servers (MLX, llama.cpp, vLLM, etc.)
//
// Connects to any local server exposing /v1/chat/completions.
// Zero external SDK dependencies — uses native fetch + SSE parsing.

import type { LlmAdapter } from "../adapter.js";
import type {
  Message,
  ThinkOnceArgs,
  ThinkResult,
  ToolCall,
  ThinkEventSink,
} from "../types.js";

// ── Config ─────────────────────────────────────────────────────────────

export interface LocalAdapterConfig {
  /** Adapter ID for logging (e.g., "mlx", "llamacpp") */
  id: string;
  /** Base URL of the local server (e.g., "http://localhost:8080") */
  baseUrl: string;
  /** Default model name to pass to the server */
  defaultModel?: string;
}

// ── Message conversion (ours → OpenAI chat format) ─────────────────────

function toOpenAIMessages(
  systemPrompt: string,
  messages: Message[],
): unknown[] {
  const out: unknown[] = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const textParts: string[] = [];
      const toolCalls: unknown[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          textParts.push((block as { text: string }).text);
        } else if (block.type === "tool_use") {
          const tu = block as { id: string; name: string; input: unknown };
          toolCalls.push({
            id: tu.id,
            type: "function",
            function: { name: tu.name, arguments: JSON.stringify(tu.input) },
          });
        }
      }
      const m: Record<string, unknown> = { role: "assistant" };
      if (textParts.length > 0) m.content = textParts.join("");
      if (toolCalls.length > 0) m.tool_calls = toolCalls;
      out.push(m);
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ((block as { type: string }).type === "tool_result") {
          const tr = block as { tool_use_id: string; content: string };
          out.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          });
        }
      }
    }
  }
  return out;
}

function toOpenAITools(
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
) {
  return tools?.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// ── SSE stream parsing ─────────────────────────────────────────────────

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch { /* skip malformed */ }
    }
  }
}

// ── Adapter ────────────────────────────────────────────────────────────

export class LocalAdapter implements LlmAdapter {
  readonly id: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: LocalAdapterConfig) {
    this.id = config.id;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.defaultModel = config.defaultModel ?? "default";
  }

  async thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    const body: Record<string, unknown> = {
      model: args.model ?? this.defaultModel,
      messages: toOpenAIMessages(args.systemPrompt, args.messages),
      max_tokens: args.maxTokens ?? 4096,
      stream: true,
    };

    const oaiTools = toOpenAITools(args.tools);
    if (oaiTools && oaiTools.length > 0) body.tools = oaiTools;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Local LLM error ${res.status}: ${errText}`);
    }

    if (!res.body) throw new Error("No response body from local LLM server");

    let text = "";
    const toolCalls: ToolCall[] = [];
    const tcAccum: Record<string, { id?: string; name: string; args: string }> = {};

    for await (const chunk of parseSSE(res.body)) {
      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      // Text content
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        args.onEvent?.({ type: "text_delta", delta: delta.content });
      }

      // Tool calls
      const dtc = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (dtc) {
        for (const tc of dtc) {
          const idx = String(tc.index ?? 0);
          if (!tcAccum[idx]) tcAccum[idx] = { name: "", args: "" };
          const fn = tc.function as Record<string, string> | undefined;
          if (fn?.name) tcAccum[idx].name = fn.name;
          if (fn?.arguments) tcAccum[idx].args += fn.arguments;
          if (typeof tc.id === "string") tcAccum[idx].id = tc.id;
        }
      }
    }

    // Finalize tool calls
    for (const [, tc] of Object.entries(tcAccum)) {
      try {
        const parsed = JSON.parse(tc.args || "{}");
        toolCalls.push({
          id: tc.id ?? `call_${Date.now().toString(36)}`,
          name: tc.name,
          input: parsed,
        });
      } catch { /* skip malformed */ }
    }

    const result: ThinkResult = {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      inputTokens: 0,
      outputTokens: 0,
    };
    args.onEvent?.({ type: "message_end", result });
    return result;
  }

  async rotateCredential(): Promise<boolean> {
    return false;
  }
}
