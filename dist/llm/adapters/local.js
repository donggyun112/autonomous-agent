// Local LLM adapter for OpenAI-compatible servers (MLX, llama.cpp, vLLM, etc.)
//
// Connects to any local server exposing /v1/chat/completions.
// Zero external SDK dependencies — uses native fetch + SSE parsing.
// ── Message conversion (ours → OpenAI chat format) ─────────────────────
function toOpenAIMessages(systemPrompt, messages) {
    const out = [{ role: "system", content: systemPrompt }];
    for (const msg of messages) {
        if (msg.role === "user" && typeof msg.content === "string") {
            out.push({ role: "user", content: msg.content });
        }
        else if (msg.role === "assistant" && Array.isArray(msg.content)) {
            const textParts = [];
            const toolCalls = [];
            for (const block of msg.content) {
                if (block.type === "text") {
                    textParts.push(block.text);
                }
                else if (block.type === "tool_use") {
                    const tu = block;
                    toolCalls.push({
                        id: tu.id,
                        type: "function",
                        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
                    });
                }
            }
            const m = { role: "assistant" };
            if (textParts.length > 0)
                m.content = textParts.join("");
            if (toolCalls.length > 0)
                m.tool_calls = toolCalls;
            out.push(m);
        }
        else if (msg.role === "user" && Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block.type === "tool_result") {
                    const tr = block;
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
function toOpenAITools(tools) {
    return tools?.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
}
// ── SSE stream parsing ─────────────────────────────────────────────────
async function* parseSSE(body) {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buf = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: "))
                continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]")
                return;
            try {
                yield JSON.parse(data);
            }
            catch { /* skip malformed */ }
        }
    }
}
// ── Adapter ────────────────────────────────────────────────────────────
export class LocalAdapter {
    id;
    baseUrl;
    defaultModel;
    constructor(config) {
        this.id = config.id;
        this.baseUrl = config.baseUrl.replace(/\/$/, "");
        this.defaultModel = config.defaultModel ?? "default";
    }
    async thinkOnce(args) {
        const url = `${this.baseUrl}/v1/chat/completions`;
        const hasTools = args.tools && args.tools.length > 0;
        const body = {
            model: args.model ?? this.defaultModel,
            messages: toOpenAIMessages(args.systemPrompt, args.messages),
            max_tokens: args.maxTokens ?? 4096,
            stream: true,
            // Sampling params — read from env or use sensible defaults.
            // Gemma4: temp=1.0, top_p=0.95, top_k=64
            // Qwen3.5: temp=0.7, top_p=0.95, top_k=20, presence_penalty=1.5
            top_k: Number(process.env.LLM_TOP_K) || 64,
            top_p: Number(process.env.LLM_TOP_P) || 0.95,
            repetition_penalty: Number(process.env.LLM_REPETITION_PENALTY) || 1.0,
            ...(process.env.LLM_PRESENCE_PENALTY ? { presence_penalty: Number(process.env.LLM_PRESENCE_PENALTY), presence_context_size: 256 } : {}),
        };
        const oaiTools = toOpenAITools(args.tools);
        if (oaiTools && oaiTools.length > 0)
            body.tools = oaiTools;
        const headers = { "Content-Type": "application/json" };
        // Support API key for cloud-compatible endpoints (OpenRouter, etc.)
        const apiKey = process.env.LOCAL_LLM_API_KEY;
        if (apiKey)
            headers["Authorization"] = `Bearer ${apiKey}`;
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error(`Local LLM error ${res.status}: ${errText}`);
        }
        if (!res.body)
            throw new Error("No response body from local LLM server");
        let text = "";
        const toolCalls = [];
        const tcAccum = {};
        let aborted = false;
        for await (const chunk of parseSSE(res.body)) {
            const choices = chunk.choices;
            const delta = choices?.[0]?.delta;
            if (!delta)
                continue;
            // Reasoning/thinking tokens (Gemma4 sends as delta.reasoning)
            if (typeof delta.reasoning === "string" && delta.reasoning) {
                const tag = text.length === 0 && !delta.reasoning.startsWith("[think]") ? "[think] " : "";
                args.onEvent?.({ type: "text_delta", delta: tag + delta.reasoning });
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
                            if (lines[i].trim() === last)
                                repeats++;
                            else
                                break;
                        }
                        if (repeats >= 3) {
                            const firstIdx = text.indexOf(last);
                            text = text.slice(0, firstIdx + last.length).trimEnd();
                            aborted = true;
                            break;
                        }
                    }
                }
            }
            // OpenAI-format streaming tool calls
            const dtc = delta.tool_calls;
            if (dtc) {
                for (const tc of dtc) {
                    const idx = String(tc.index ?? 0);
                    if (!tcAccum[idx])
                        tcAccum[idx] = { name: "", args: "" };
                    const fn = tc.function;
                    if (fn?.name)
                        tcAccum[idx].name = fn.name;
                    if (fn?.arguments)
                        tcAccum[idx].args += fn.arguments;
                    if (typeof tc.id === "string")
                        tcAccum[idx].id = tc.id;
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
            }
            catch { /* skip malformed */ }
        }
        // Gemma4 fallback: tool calls may appear as text in the format
        // call:name{args} — parse them if no streaming tool_calls were found.
        if (toolCalls.length === 0 && text.includes("call:")) {
            const callPattern = /call:(\w+)\{([\s\S]*?)\}(?:<tool_call\|>|$)/g;
            let m;
            while ((m = callPattern.exec(text)) !== null) {
                try {
                    let argsStr = m[2];
                    // Gemma4 uses <|"|> for string delimiters — convert to JSON quotes
                    argsStr = argsStr.replace(/<\|"\|>(.*?)<\|"\|>/gs, (_, s) => JSON.stringify(s));
                    argsStr = argsStr.replace(/(?<=[{,])(\w+):/g, '"$1":');
                    const parsed = JSON.parse(`{${argsStr}}`);
                    toolCalls.push({
                        id: `call_${Date.now().toString(36)}_${toolCalls.length}`,
                        name: m[1],
                        input: parsed,
                    });
                }
                catch { /* skip malformed */ }
            }
            // Remove tool call text from visible output
            if (toolCalls.length > 0) {
                text = text.replace(/<\|tool_call\|>[\s\S]*?<tool_call\|>/g, "").trim();
                text = text.replace(/call:\w+\{[\s\S]*?\}(?:<tool_call\|>|$)/g, "").trim();
            }
        }
        if (aborted) {
            console.warn(`[${this.id}] repetition detected — output truncated at ${text.length} chars`);
        }
        const result = {
            text,
            toolCalls,
            stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
            inputTokens: 0,
            outputTokens: 0,
        };
        args.onEvent?.({ type: "message_end", result });
        return result;
    }
    async rotateCredential() {
        return false;
    }
}
//# sourceMappingURL=local.js.map