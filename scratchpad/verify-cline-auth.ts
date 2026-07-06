// End-to-end verify: production refresh path → prefixed token → real chat call
// through the registered cline adapter (same wiring the live loop uses).
// Run: npx tsx scratchpad/verify-cline-auth.ts
import "dotenv/config";
import { loadClineAccessToken } from "../src/llm/auth/cline.js";
import { createDefaultRegistry } from "../src/llm/adapter.js";

const token = await loadClineAccessToken({ forceRefresh: true });
console.log("[1] forceRefresh OK — token prefix:", token.slice(0, 7), "len:", token.length);

const adapter = await createDefaultRegistry().get("cline");
const result = await adapter.thinkOnce({
  model: process.env.CLINE_MODEL ?? "cline-pass/glm-5.2",
  systemPrompt: "",
  messages: [{ role: "user", content: "Reply with the single word: pong" }],
  maxTokens: 16,
});
console.log("[2] chat OK — text:", JSON.stringify(result.text.slice(0, 60)), "stopReason:", result.stopReason);
