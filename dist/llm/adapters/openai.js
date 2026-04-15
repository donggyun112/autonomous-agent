// OpenAI LLM adapter.
//
// Handles OpenAI SDK calls, message format conversion from Anthropic-native,
// tool definition translation, streaming, and broken-JSON repair.
// ── Message / tool conversion ──────────────────────────────────────────
function convertMessages(systemPrompt, messages) {
    const oai = [
        { role: "system", content: systemPrompt },
    ];
    for (const m of messages) {
        if (m.role === "user" && typeof m.content === "string") {
            oai.push({ role: "user", content: m.content });
        }
        else if (m.role === "assistant" && Array.isArray(m.content)) {
            const parts = [];
            const toolCallParts = [];
            for (const block of m.content) {
                if ("type" in block && block.type === "text" && "text" in block) {
                    parts.push(block.text);
                }
                else if ("type" in block && block.type === "tool_use") {
                    const tu = block;
                    toolCallParts.push({
                        id: tu.id,
                        type: "function",
                        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
                    });
                }
            }
            const msg = { role: "assistant" };
            if (parts.length > 0)
                msg.content = parts.join("");
            if (toolCallParts.length > 0)
                msg.tool_calls = toolCallParts;
            oai.push(msg);
        }
        else if (m.role === "user" && Array.isArray(m.content)) {
            for (const block of m.content) {
                if ("type" in block && block.type === "tool_result") {
                    const tr = block;
                    oai.push({ role: "tool", tool_call_id: tr.tool_use_id, content: tr.content });
                }
            }
        }
    }
    return oai;
}
function convertTools(tools) {
    return tools?.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
}
// ── Broken-JSON repair for GPT streaming ───────────────────────────────
function repairToolArgs(raw) {
    let clean = raw || "{}";
    try {
        return JSON.parse(clean);
    }
    catch { /* fall through */ }
    try {
        // Strip broken \uXXXX (incomplete, unpaired surrogates)
        clean = clean.replace(/\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/g, "");
        clean = clean.replace(/\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u)/g, "");
        // Fix unterminated strings
        clean = clean.replace(/([^\\])"([^"]*$)/, '$1"$2"');
        // Remove trailing comma before } or ]
        clean = clean.replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(clean);
    }
    catch { /* fall through */ }
    try {
        const nameMatch = clean.match(/"(\w+)"\s*:\s*"([^"]*)"/g);
        if (nameMatch) {
            const parsed = {};
            for (const m of nameMatch) {
                const kv = m.match(/"(\w+)"\s*:\s*"([^"]*)"/);
                if (kv)
                    parsed[kv[1]] = kv[2];
            }
            return parsed;
        }
    }
    catch { /* give up */ }
    return null;
}
// ── Adapter implementation ─────────────────────────────────────────────
export class OpenAIAdapter {
    id = "openai";
    async thinkOnce(args) {
        const OpenAI = (await import("openai")).default;
        let apiKey = process.env.OPENAI_API_KEY;
        try {
            // @ts-ignore — pi-ai oauth module for token exchange
            const { getOAuthApiKey } = await import("@mariozechner/pi-ai/dist/oauth.js");
            const { loadCredentials } = await import("../auth/storage.js");
            const creds = await loadCredentials();
            if (creds.openai) {
                const result = await getOAuthApiKey("openai-codex", {
                    "openai-codex": {
                        access: creds.openai.access,
                        refresh: creds.openai.refresh,
                        expires: creds.openai.expires,
                    },
                });
                if (result) {
                    apiKey = result.apiKey;
                    const { saveOpenAICredentials } = await import("../auth/storage.js");
                    await saveOpenAICredentials({ ...result.newCredentials, idToken: creds.openai.idToken });
                }
            }
        }
        catch { /* fallback to env key */ }
        if (!apiKey) {
            throw new Error("No OpenAI auth available. Set OPENAI_API_KEY in .env.");
        }
        const client = new OpenAI({ apiKey });
        const oaiMessages = convertMessages(args.systemPrompt, args.messages);
        const oaiTools = convertTools(args.tools);
        const response = await client.chat.completions.create({
            model: args.model,
            max_completion_tokens: args.maxTokens ?? 4096,
            messages: oaiMessages,
            tools: oaiTools,
            stream: true,
        });
        let text = "";
        const toolCalls = [];
        const tcAccum = {};
        for await (const chunk of response) {
            const delta = chunk.choices[0]?.delta;
            if (!delta)
                continue;
            if (delta.content) {
                text += delta.content;
                args.onEvent?.({ type: "text_delta", delta: delta.content });
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = String(tc.index);
                    if (!tcAccum[idx])
                        tcAccum[idx] = { name: "", args: "" };
                    if (tc.function?.name)
                        tcAccum[idx].name = tc.function.name;
                    if (tc.function?.arguments)
                        tcAccum[idx].args += tc.function.arguments;
                    if (tc.id)
                        tcAccum[idx].id = tc.id;
                }
            }
        }
        for (const [, tc] of Object.entries(tcAccum)) {
            const parsed = repairToolArgs(tc.args);
            if (parsed) {
                toolCalls.push({
                    id: tc.id ?? `call_${Date.now().toString(36)}`,
                    name: tc.name,
                    input: parsed,
                });
            }
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
//# sourceMappingURL=openai.js.map