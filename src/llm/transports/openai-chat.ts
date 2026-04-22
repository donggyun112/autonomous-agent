// OpenAI Chat Completions transport.
//
// Talks to any server exposing /v1/chat/completions (OpenAI, MLX, llama.cpp, vLLM).
// Uses native fetch + SSE parsing — no SDK dependency.

import type { LlmTransport, TransportCallArgs } from "./types.js";
import type { Message, ToolCall, ToolDefinition, ThinkResult } from "../types.js";

// ── Message conversion (ours → OpenAI chat format) ─────────────────────

function toOpenAIMessages(systemPrompt: string, messages: Message[]): unknown[] {
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

function toOpenAITools(tools?: ToolDefinition[]) {
  return tools?.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// ── SSE stream parsing ─────────────────────────────────────────────────

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // Flush remaining buffer + decoder at EOF
      buf += decoder.decode(new Uint8Array(), { stream: false });
      break;
    }
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
      if (data === "[DONE]") return;
      try { yield JSON.parse(data); } catch { /* skip malformed */ }
    }
  }

  // Parse any remaining data in the buffer after EOF
  if (buf.trim()) {
    for (const line of buf.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
      if (data === "[DONE]") return;
      try { yield JSON.parse(data); } catch { /* skip */ }
    }
  }
}

// ── Transport ──────────────────────────────────────────────────────────

export class OpenAIChatTransport implements LlmTransport {
  readonly protocol = "openai-chat" as const;

  async call(args: TransportCallArgs): Promise<ThinkResult> {
    const url = `${args.config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
    const hasTools = args.tools && args.tools.length > 0;

    const body: Record<string, unknown> = {
      model: args.model,
      messages: toOpenAIMessages(args.systemPrompt, args.messages),
      max_tokens: args.maxTokens,
      stream: !hasTools, // non-streaming when tools present (MLX can't stream tool calls)
    };

    // Sampling params
    if (args.sampling) {
      if (args.sampling.topK) body.top_k = args.sampling.topK;
      if (args.sampling.topP) body.top_p = args.sampling.topP;
      if (args.sampling.temperature !== undefined) body.temperature = args.sampling.temperature;
      if (args.sampling.repetitionPenalty && args.sampling.repetitionPenalty > 1.0) {
        body.repetition_penalty = args.sampling.repetitionPenalty;
        body.repetition_context_size = 256;
      }
      if (args.sampling.minP !== undefined) body.min_p = args.sampling.minP;
      if (args.sampling.presencePenalty !== undefined) {
        body.presence_penalty = args.sampling.presencePenalty;
        body.presence_context_size = 64;
      }
    }

    const oaiTools = toOpenAITools(args.tools);
    if (oaiTools && oaiTools.length > 0) body.tools = oaiTools;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...args.config.headers,
    };
    if (args.config.apiKey) {
      headers["Authorization"] = `Bearer ${args.config.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI-chat error ${res.status}: ${errText}`);
    }

    // ── Non-streaming path (tools present) ────────────────────────
    if (hasTools) {
      return this.parseNonStreaming(await res.json(), args);
    }

    // ── Streaming path ────────────────────────────────────────────
    if (!res.body) throw new Error("No response body");
    return this.parseStreaming(res.body, args);
  }

  private parseNonStreaming(
    json: Record<string, unknown>,
    args: TransportCallArgs,
  ): ThinkResult {
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
    const usage = json.usage as Record<string, number> | undefined;

    let text = typeof msg?.content === "string" ? msg.content : "";
    const toolCalls: ToolCall[] = [];

    // mlx-lm sends thinking as a separate `reasoning` field
    let reasoning = typeof msg?.reasoning === "string" ? msg.reasoning : "";
    if (reasoning) {
      args.onEvent?.({ type: "text_delta", delta: `[think] ${reasoning}\n` });
    }

    // Extract inline <think> blocks — preserve any tool calls inside them
    // before stripping. Qwen sometimes puts <function=...> inside <think>.
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      // Append think content to reasoning so quirks can scan it
      if (!reasoning) reasoning = thinkMatch[1];
      else reasoning += "\n" + thinkMatch[1];
    }
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    // Also strip <tool_call> wrappers from text (tool calls will be parsed by quirks)
    text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();

    // Parse structured tool_calls
    const tc = msg?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (tc) {
      for (const call of tc) {
        const fn = call.function as Record<string, unknown> | undefined;
        if (!fn?.name) continue;
        try {
          const parsed = typeof fn.arguments === "string"
            ? JSON.parse(fn.arguments) : fn.arguments ?? {};
          toolCalls.push({
            id: (call.id as string) ?? `call_${Date.now().toString(36)}`,
            name: fn.name as string,
            input: parsed,
          });
        } catch { /* skip */ }
      }
    }

    const result: ThinkResult = {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      reasoning: reasoning || undefined,
    };
    if (text) args.onEvent?.({ type: "text_delta", delta: text });
    args.onEvent?.({ type: "message_end", result });
    return result;
  }

  private async parseStreaming(
    body: ReadableStream<Uint8Array>,
    args: TransportCallArgs,
  ): Promise<ThinkResult> {
    let text = "";
    let reasoning = "";
    const toolCalls: ToolCall[] = [];
    const tcAccum: Record<string, { id?: string; name: string; args: string }> = {};
    let aborted = false;

    for await (const chunk of parseSSE(body)) {
      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      // Reasoning/thinking tokens — accumulate for quirks
      if (typeof delta.reasoning === "string" && delta.reasoning) {
        reasoning += delta.reasoning;
        const tag = text.length === 0 && !delta.reasoning.startsWith("[think]") ? "[think] " : "";
        args.onEvent?.({ type: "text_delta", delta: tag + delta.reasoning });

        // Repetition detection in reasoning (same logic as text)
        if (reasoning.length > 500) {
          const rLines = reasoning.split("\n").filter(l => l.trim().length > 10);
          if (rLines.length >= 3) {
            const last = rLines[rLines.length - 1].trim();
            let repeats = 0;
            for (let i = rLines.length - 1; i >= 0; i--) {
              if (rLines[i].trim() === last) repeats++;
              else break;
            }
            if (repeats >= 3) {
              const firstIdx = reasoning.indexOf(last);
              if (firstIdx !== -1) reasoning = reasoning.slice(0, firstIdx + last.length).trimEnd();
              aborted = true;
              break;
            }
          }
          // Also detect substring repetition (same phrase repeated without newlines)
          if (reasoning.length > 1000) {
            const tail = reasoning.slice(-200);
            const pattern = tail.slice(-50);
            if (pattern.length >= 20 && reasoning.slice(0, -50).includes(pattern) &&
                reasoning.split(pattern).length > 5) {
              reasoning = reasoning.slice(0, reasoning.indexOf(pattern) + pattern.length);
              aborted = true;
              break;
            }
          }
        }
      }

      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        args.onEvent?.({ type: "text_delta", delta: delta.content });

        // Repetition detection
        if (text.length > 300) {
          const lines = text.split("\n").filter(l => l.trim().length > 10);
          if (lines.length >= 3) {
            const last = lines[lines.length - 1].trim();
            let repeats = 0;
            for (let i = lines.length - 1; i >= 0; i--) {
              if (lines[i].trim() === last) repeats++;
              else break;
            }
            if (repeats >= 3) {
              const firstIdx = text.indexOf(last);
              if (firstIdx !== -1) text = text.slice(0, firstIdx + last.length).trimEnd();
              aborted = true;
              break;
            }
          }
        }
      }

      // Streaming tool calls
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

    // Finalize streaming tool calls
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

    if (aborted) {
      console.warn(`[openai-chat] repetition detected — output truncated at ${text.length} chars`);
    }

    const result: ThinkResult = {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      inputTokens: 0,
      outputTokens: 0,
      reasoning: reasoning || undefined,
    };
    args.onEvent?.({ type: "message_end", result });
    return result;
  }
}
