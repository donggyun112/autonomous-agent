// End-to-end verify: production refresh path → prefixed token → real chat call
// through the agent's own OpenAIChatTransport. Run: npx tsx scratchpad/verify-cline-auth.ts
import { loadClineAccessToken } from "../src/llm/auth/cline.js";
import { OpenAIChatTransport } from "../src/llm/transports/openai-chat.js";

const token = await loadClineAccessToken({ forceRefresh: true });
console.log("[1] forceRefresh OK — token prefix:", token.slice(0, 7), "len:", token.length);

const transport = new OpenAIChatTransport();
const result = await transport.call({
  model: process.env.CLINE_MODEL ?? "cline-pass/glm-5.2",
  systemPrompt: "",
  messages: [{ role: "user", content: "Reply with the single word: pong" }],
  maxTokens: 16,
  config: {
    apiKey: token,
    baseUrl: process.env.CLINE_BASE_URL ?? "https://api.cline.bot/api",
    forceNonStreaming: true,
  },
});
console.log("[2] chat OK — text:", JSON.stringify(result.text.slice(0, 60)), "stopReason:", result.stopReason);
