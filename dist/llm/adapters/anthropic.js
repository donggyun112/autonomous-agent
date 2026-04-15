// Anthropic LLM adapter.
//
// Handles Anthropic SDK calls, OAuth/API-key detection, system prompt
// construction, and streaming event emission.
import Anthropic from "@anthropic-ai/sdk";
import { getAuthSource } from "../auth/source.js";
// Detect whether a credential is an OAuth access token or an API key.
// OAuth tokens start with `sk-ant-oat`; API keys start with `sk-ant-api`.
function isOAuthToken(apiKey) {
    return apiKey.includes("sk-ant-oat");
}
// Build a fresh Anthropic client per request so rotated tokens take effect.
function buildClient(apiKey) {
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
// OAuth tokens require the first system block to be Claude Code's identity.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
function buildSystem(isOAuth, systemPrompt) {
    if (!isOAuth)
        return systemPrompt;
    return [
        { type: "text", text: CLAUDE_CODE_IDENTITY },
        { type: "text", text: systemPrompt },
    ];
}
// ── Adapter implementation ─────────────────────────────────────────────
export class AnthropicAdapter {
    id = "anthropic";
    async thinkOnce(args) {
        const source = await getAuthSource();
        const apiKey = await source.getApiKey();
        const { client, isOAuth } = buildClient(apiKey);
        const stream = client.messages.stream({
            model: args.model,
            max_tokens: args.maxTokens ?? 4096,
            system: buildSystem(isOAuth, args.systemPrompt),
            messages: args.messages,
            tools: args.tools,
        });
        if (args.onEvent) {
            stream.on("text", (delta) => {
                args.onEvent({ type: "text_delta", delta });
            });
            stream.on("contentBlock", (block) => {
                if (block.type === "tool_use") {
                    args.onEvent({ type: "tool_use_end", id: block.id });
                }
            });
        }
        const response = await stream.finalMessage();
        let text = "";
        const toolCalls = [];
        for (const block of response.content) {
            if (block.type === "text") {
                text += block.text;
            }
            else if (block.type === "tool_use") {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    input: block.input,
                });
            }
        }
        const result = {
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
    async rotateCredential() {
        const source = await getAuthSource();
        if ("rotateCredential" in source && typeof source.rotateCredential === "function") {
            return await source.rotateCredential();
        }
        return false;
    }
}
//# sourceMappingURL=anthropic.js.map