// Unified LLM adapter using @mariozechner/pi-ai.
//
// A single adapter class handles all providers (Anthropic, OpenAI, …)
// through pi-ai's getModel() + streamSimple(). Provider-specific details
// (auth, caching, OAuth identity) are injected via PiAdapterConfig.
// OAuth tokens from Anthropic's OAuth server require this identity prefix.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
// ── Message format conversion (ours → pi-ai) ──────────────────────────
function toPiMessages(messages) {
    const out = [];
    // Track last assistant blocks to look up toolName for tool_result
    let lastAssistantBlocks = [];
    for (const msg of messages) {
        if (msg.role === "user" && typeof msg.content === "string") {
            out.push({ role: "user", content: msg.content, timestamp: Date.now() });
            lastAssistantBlocks = [];
        }
        else if (msg.role === "assistant" && Array.isArray(msg.content)) {
            lastAssistantBlocks = msg.content;
            const content = msg.content.map((block) => {
                if (block.type === "text") {
                    return { type: "text", text: block.text };
                }
                if (block.type === "tool_use") {
                    const tu = block;
                    return {
                        type: "toolCall",
                        id: tu.id,
                        name: tu.name,
                        arguments: tu.input,
                    };
                }
                return block;
            });
            const hasToolCall = content.some((b) => b.type === "toolCall");
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
        }
        else if (msg.role === "user" && Array.isArray(msg.content)) {
            // tool_result blocks → individual pi-ai ToolResultMessage
            for (const block of msg.content) {
                if (block.type === "tool_result") {
                    const tr = block;
                    const match = lastAssistantBlocks.find((b) => b.type === "tool_use" && b.id === tr.tool_use_id);
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
async function collectStream(stream, onEvent) {
    let text = "";
    const toolCalls = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = null;
    for await (const ev of stream) {
        switch (ev.type) {
            case "text_delta":
                text += ev.delta;
                onEvent?.({ type: "text_delta", delta: ev.delta });
                break;
            case "toolcall_start": {
                const partial = ev.partial;
                const content = partial?.content;
                const tc = content?.[ev.contentIndex];
                if (tc) {
                    onEvent?.({
                        type: "tool_use_start",
                        id: tc.id ?? "",
                        name: tc.name ?? "",
                    });
                }
                break;
            }
            case "toolcall_delta": {
                const partial = ev.partial;
                const content = partial?.content;
                const tc = content?.[ev.contentIndex];
                onEvent?.({
                    type: "tool_use_delta",
                    id: tc?.id ?? "",
                    partial: ev.delta,
                });
                break;
            }
            case "toolcall_end": {
                const tc = ev.toolCall;
                onEvent?.({ type: "tool_use_end", id: tc.id });
                toolCalls.push({ id: tc.id, name: tc.name, input: tc.arguments ?? {} });
                break;
            }
            case "done": {
                const reason = ev.reason;
                stopReason = reason === "toolUse" ? "tool_use" : "end_turn";
                const msg = ev.message;
                const usage = msg?.usage;
                if (usage) {
                    inputTokens = usage.inputTokens ?? 0;
                    outputTokens = usage.outputTokens ?? 0;
                }
                // Collect text from final message if streaming missed any
                if (!text) {
                    const blocks = msg?.content;
                    if (blocks) {
                        for (const block of blocks) {
                            if (block.type === "text")
                                text += block.text;
                        }
                    }
                }
                break;
            }
            case "error": {
                const errMsg = ev.error;
                throw new Error(errMsg?.errorMessage ?? "LLM stream error");
            }
        }
    }
    const result = {
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
export class PiAdapter {
    id;
    piProvider;
    getApiKeyFn;
    rotateCredentialFn;
    cacheRetention;
    constructor(config) {
        this.id = config.id;
        this.piProvider = config.piProvider;
        this.getApiKeyFn = config.getApiKey;
        this.rotateCredentialFn = config.rotateCredentialFn;
        this.cacheRetention = config.cacheRetention;
    }
    async thinkOnce(args) {
        // Dynamic import — heavy SDK only loaded when actually used.
        const { getModel, streamSimple } = await import("@mariozechner/pi-ai");
        const apiKey = await this.getApiKeyFn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = getModel(this.piProvider, args.model);
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
        const stream = streamSimple(model, context, {
            apiKey,
            maxTokens: args.maxTokens ?? 4096,
            ...(this.cacheRetention ? { cacheRetention: this.cacheRetention } : {}),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return collectStream(stream, args.onEvent);
    }
    async rotateCredential() {
        return this.rotateCredentialFn?.() ?? false;
    }
}
//# sourceMappingURL=pi.js.map