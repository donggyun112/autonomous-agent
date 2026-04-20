// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// The inner-voice layer. The agent's think() entry point. Retry logic,
// backoff, logging, and adapter dispatch live here. Provider-specific code
// lives in ./adapters/*.ts behind the LlmAdapter interface.
// ===========================================================================

import { config } from "dotenv";
import { classifyError } from "../core/errors.js";
import { logSystem } from "../core/system-log.js";
import { createDefaultRegistry, resolveProviderFromModel, type LlmAdapter } from "./adapter.js";
import type { LlmProvider, ThinkOnceArgs, ThinkResult } from "./types.js";

config();

// Re-export all types so existing consumers keep working with their
// `import { think, type Message, ... } from "../llm/client.js"` imports.
export type {
  LlmProvider,
  Message,
  ToolDefinition,
  ToolCall,
  ThinkResult,
  ThinkEvent,
  ThinkEventSink,
  ThinkOnceArgs,
} from "./types.js";

// ── Provider / model config resolution ─────────────────────────────────

const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-6";
const DEFAULT_ANTHROPIC_AUXILIARY_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_OPENAI_AUXILIARY_MODEL = "gpt-5.4-nano";

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) return value;
  }
  return undefined;
}

function normalizeProvider(rawProvider: string | undefined, env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const p = rawProvider?.toLowerCase();
  if (p === "openai") return "openai";
  if (p === "local" || p === "ollama") return "local";
  if (p === "anthropic") return "anthropic";
  // Default: if LOCAL_LLM_URL is set, use local; otherwise anthropic
  if (env.LOCAL_LLM_URL) return "local";
  return "anthropic";
}

export function resolveProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): {
  provider: LlmProvider;
  defaultModel: string;
  auxiliaryModel: string;
} {
  const provider = normalizeProvider(env.AGENT_LLM, env);

  if (provider === "local") {
    const model = firstNonEmpty(env.AGENT_MODEL, env.LOCAL_LLM_MODEL) ?? "default";
    return {
      provider,
      defaultModel: model,
      auxiliaryModel: model, // local models typically use same model
    };
  }

  if (provider === "openai") {
    return {
      provider,
      defaultModel:
        firstNonEmpty(env.AGENT_MODEL, env.OPENAI_MODEL) ?? DEFAULT_OPENAI_MODEL,
      auxiliaryModel:
        firstNonEmpty(env.AUXILIARY_MODEL, env.OPENAI_AUXILIARY_MODEL) ??
        DEFAULT_OPENAI_AUXILIARY_MODEL,
    };
  }

  return {
    provider,
    defaultModel:
      firstNonEmpty(env.AGENT_MODEL, env.ANTHROPIC_MODEL) ??
      DEFAULT_ANTHROPIC_MODEL,
    auxiliaryModel:
      firstNonEmpty(env.AUXILIARY_MODEL, env.ANTHROPIC_AUXILIARY_MODEL) ??
      DEFAULT_ANTHROPIC_AUXILIARY_MODEL,
  };
}

const {
  provider: LLM_PROVIDER,
  defaultModel: DEFAULT_MODEL,
  auxiliaryModel: AUXILIARY_MODEL,
} = resolveProviderConfig();

// ── Adapter registry ───────────────────────────────────────────────────

const registry = createDefaultRegistry();

// ── Retry / backoff ────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function backoffMs(attempt: number): number {
  const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Per-provider default models (env-driven, no hardcoding in adapters) ─

function defaultModelFor(provider: LlmProvider): string {
  if (provider === "openai") {
    return firstNonEmpty(process.env.OPENAI_MODEL) ?? DEFAULT_OPENAI_MODEL;
  }
  if (provider === "anthropic") {
    return firstNonEmpty(process.env.ANTHROPIC_MODEL) ?? DEFAULT_ANTHROPIC_MODEL;
  }
  // Local providers use LOCAL_LLM_MODEL
  if (process.env.LOCAL_LLM_URL) {
    return process.env.LOCAL_LLM_MODEL ?? "default";
  }
  const envKey = `${provider.toUpperCase()}_MODEL`;
  return process.env[envKey] ?? DEFAULT_MODEL;
}

// ── Retry loop for a single adapter ────────────────────────────────────

// Categories where switching provider won't help (the problem is the content).
const NO_FALLBACK_CATEGORIES = new Set(["context_overflow", "filesystem"]);

async function thinkWithRetry(
  adapter: LlmAdapter,
  args: ThinkOnceArgs,
): Promise<ThinkResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const start = Date.now();
      const result = await adapter.thinkOnce(args);
      const durationMs = Date.now() - start;
      try {
        await logSystem({
          ts: new Date().toISOString(),
          event: "llm_call",
          detail: adapter.id,
          model: args.model!,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          durationMs,
        });
      } catch {
        // logging must never crash the caller
      }
      return result;
    } catch (err: unknown) {
      lastError = err;
      const classified = classifyError(err);

      // Auth errors: let the adapter try rotating credentials.
      if (
        classified.category === "auth" &&
        classified.recovery.should_rotate_credential
      ) {
        const rotated = await adapter.rotateCredential();
        if (rotated && attempt < MAX_RETRIES) continue;
      }

      if (!classified.recovery.retryable || attempt >= MAX_RETRIES) throw err;

      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

// ── Public API ─────────────────────────────────────────────────────────

export async function think(args: ThinkOnceArgs & {
  provider?: LlmProvider;
}): Promise<ThinkResult> {
  // Self-test mock — never touches the network.
  if (process.env.SELF_TEST_MOCK_LLM === "1") {
    const adapter = await registry.get("mock");
    return adapter.thinkOnce(args);
  }

  // Resolve primary adapter: explicit provider > model-name heuristic > global default.
  const targetProvider =
    args.provider
    ?? (args.model ? resolveProviderFromModel(args.model) : null)
    ?? LLM_PROVIDER;

  const model = args.model ?? DEFAULT_MODEL;

  // Try primary adapter with full retry.
  try {
    const adapter = await registry.get(targetProvider);
    return await thinkWithRetry(adapter, { ...args, model });
  } catch (primaryErr: unknown) {
    // Don't fallback for content-level errors (context overflow, filesystem).
    const classified = classifyError(primaryErr);
    if (NO_FALLBACK_CATEGORIES.has(classified.category)) throw primaryErr;

    // Fallback: try every other registered provider.
    const fallbacks = registry.providers.filter((p) => p !== targetProvider);
    if (fallbacks.length === 0) throw primaryErr;

    let lastFallbackErr: unknown = primaryErr;
    for (const fbProvider of fallbacks) {
      try {
        const fbAdapter = await registry.get(fbProvider);
        const fbModel = defaultModelFor(fbProvider);
        try {
          await logSystem({
            ts: new Date().toISOString(),
            event: "llm_fallback",
            detail: `${targetProvider} → ${fbProvider}`,
            reason: classified.message,
          });
        } catch { /* logging never crashes */ }
        return await thinkWithRetry(fbAdapter, { ...args, model: fbModel });
      } catch (err) {
        lastFallbackErr = err;
        continue;
      }
    }
    // Every provider failed.
    throw lastFallbackErr;
  }
}

// Auxiliary model variant — same signature but defaults to a cheaper model.
export async function thinkAux(args: ThinkOnceArgs & {
  provider?: LlmProvider;
}): Promise<ThinkResult> {
  return think({
    ...args,
    model: args.model ?? AUXILIARY_MODEL,
  });
}
