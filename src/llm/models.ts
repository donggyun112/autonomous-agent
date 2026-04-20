// Model metadata registry.
//
// Maps model IDs to their transport, context window, and quirks.
// Unknown models are inferred from name patterns or default to openai-chat.

import type { ModelMeta } from "./types.js";

const KNOWN_MODELS: Record<string, ModelMeta> = {
  // ── Anthropic ─────────────────────────────────────────────
  "claude-opus-4-6":            { id: "claude-opus-4-6",            transport: "anthropic-messages", contextWindow: 200_000, maxOutputTokens: 32_768, supportsThinking: true },
  "claude-sonnet-4-6":          { id: "claude-sonnet-4-6",          transport: "anthropic-messages", contextWindow: 200_000, maxOutputTokens: 16_384, supportsThinking: true },
  "claude-sonnet-4-20250514":   { id: "claude-sonnet-4-20250514",   transport: "anthropic-messages", contextWindow: 200_000, maxOutputTokens: 16_384, supportsThinking: true },
  "claude-haiku-4-5-20251001":  { id: "claude-haiku-4-5-20251001",  transport: "anthropic-messages", contextWindow: 200_000, maxOutputTokens: 8_192,  supportsThinking: false },

  // ── OpenAI ────────────────────────────────────────────────
  "gpt-4.1":                    { id: "gpt-4.1",                    transport: "openai-chat", contextWindow: 1_000_000, maxOutputTokens: 32_768 },
  "gpt-4.1-mini":               { id: "gpt-4.1-mini",               transport: "openai-chat", contextWindow: 1_000_000, maxOutputTokens: 16_384 },
  "gpt-4.1-nano":               { id: "gpt-4.1-nano",               transport: "openai-chat", contextWindow: 1_000_000, maxOutputTokens: 16_384 },
  "gpt-5.4-mini":               { id: "gpt-5.4-mini",               transport: "openai-chat", contextWindow: 128_000,   maxOutputTokens: 16_384 },
  "gpt-5.4-nano":               { id: "gpt-5.4-nano",               transport: "openai-chat", contextWindow: 128_000,   maxOutputTokens: 16_384 },
};

/** Auto-detect quirks from model name. */
function detectQuirks(model: string): string[] {
  const lower = model.toLowerCase();
  if (lower.includes("gemma")) return ["gemma4-tool-parse"];
  if (lower.includes("qwen")) return ["qwen3-tool-parse"];
  return [];
}

/** Get metadata for a model. Falls back to heuristics for unknown models. */
export function getModelMeta(model: string): ModelMeta {
  if (KNOWN_MODELS[model]) return KNOWN_MODELS[model];

  // Heuristic: claude- prefix → anthropic
  if (model.startsWith("claude-")) {
    return { id: model, transport: "anthropic-messages", supportsThinking: true };
  }
  // gpt-, o1, o3 → openai
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) {
    return { id: model, transport: "openai-chat" };
  }
  // Local/unknown → openai-chat (local servers are OpenAI-compatible)
  return {
    id: model,
    transport: "openai-chat",
    contextWindow: Number(process.env.LOCAL_LLM_CONTEXT) || undefined,
    quirks: detectQuirks(model),
  };
}
