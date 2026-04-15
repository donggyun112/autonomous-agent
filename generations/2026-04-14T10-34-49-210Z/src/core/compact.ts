// Auto-compact for within-cycle messages.
//
// When the conversation inside a cycle grows past a soft threshold, we ask
// the LLM to summarize the older half of the messages and replace them with
// a single synthetic user message containing the summary. This keeps the
// recent context intact (where the live tool calls are happening) while
// freeing room.
//
// This is a much simpler version of claude-code's auto-compact (which has
// snip + microcompact + autocompact + collapse layered together). For our
// contemplative agent it does not need to be elaborate.

import { resolveProviderConfig, think, type Message } from "../llm/client.js";
import { isToolPreserved } from "./tools.js";
import { logSystem } from "./system-log.js";

// Rough estimate: ~4 characters per token. We use char count instead of
// calling the API counter every turn — fast, cheap, good enough.
const CHARS_PER_TOKEN = 4;

// Hermes pattern: trigger compaction at 50% of model context window.
// Model context sizes (tokens):
const MODEL_CONTEXT: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4.1-mini": 1_000_000,
  "gpt-4.1-nano": 1_000_000,
  "gpt-5.4-mini": 1_000_000,
  "gpt-5.4-nano": 1_000_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-opus-4-6": 200_000,
};
// Local models: use LOCAL_LLM_CONTEXT env or conservative default.
// Small models (9B) can technically handle 262K but degrade after ~32K.
const LOCAL_CONTEXT = parseInt(process.env.LOCAL_LLM_CONTEXT ?? "32000", 10);
const DEFAULT_CONTEXT = process.env.LOCAL_LLM_URL ? LOCAL_CONTEXT : 128_000;

function getContextBudget(): { triggerTokens: number; keepRecentTokens: number } {
  const { defaultModel } = resolveProviderConfig();
  const contextSize = MODEL_CONTEXT[defaultModel] ?? DEFAULT_CONTEXT;
  // Hermes: trigger at 50% of context window
  const triggerTokens = Math.floor(contextSize * 0.5);
  // Keep recent 20% of context window (Hermes uses ~20K for 128K context)
  const keepRecentTokens = Math.floor(contextSize * 0.15);
  return { triggerTokens, keepRecentTokens };
}

// Hermes pattern: old tool results in the middle of conversation are rarely
// useful. Before the expensive LLM summarization pass, we do a cheap pre-prune:
// tool_result blocks before the split point get replaced with a short
// placeholder. The LLM summarizer then works with much less noise.
const PRUNED_PLACEHOLDER = "[Old tool output cleared to save context space]";

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      chars += m.content.length;
    } else {
      for (const block of m.content) {
        if ("text" in block) chars += block.text.length;
        if ("content" in block && typeof block.content === "string") {
          chars += block.content.length;
        }
        if ("input" in block && block.input != null) {
          chars += JSON.stringify(block.input).length;
        }
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function messagesAsText(messages: Message[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      parts.push(`${m.role}: ${m.content}`);
    } else {
      for (const block of m.content) {
        if ("text" in block) {
          parts.push(`${m.role}/text: ${block.text}`);
        } else if ("content" in block && typeof block.content === "string") {
          parts.push(`${m.role}/tool_result: ${block.content}`);
        } else if ("name" in block) {
          parts.push(
            `${m.role}/tool_use: ${block.name}(${JSON.stringify(block.input)})`,
          );
        }
      }
    }
  }
  return parts.join("\n\n");
}

// Extract a brief summary of tool calls from a set of messages, used to
// populate the "## Actions taken" section in the compaction summary.
function extractToolActions(messages: Message[]): string {
  const actions: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if ("type" in block && block.type === "tool_use" && "name" in block) {
        const name = (block as { name: string }).name;
        const input = (block as { input?: unknown }).input;
        // Extract a short descriptor from the input (first string arg or query).
        let detail = "";
        if (input && typeof input === "object") {
          const obj = input as Record<string, unknown>;
          const key = obj.query ?? obj.text ?? obj.slug ?? obj.path ?? obj.name ?? obj.question;
          if (typeof key === "string") {
            detail = `: ${key.length > 60 ? key.slice(0, 60) + "..." : key}`;
          }
        }
        actions.push(`- ${name}${detail}`);
      }
    }
  }
  return actions.length > 0 ? actions.join("\n") : "(no tool calls)";
}

// Find the split point so that everything after `split` is roughly
// `KEEP_RECENT_TOKENS` worth of content.
function findSplit(messages: Message[], keepRecentTokens: number): number {
  let kept = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens([messages[i]]);
    if (kept + msgTokens > keepRecentTokens) {
      // Make sure we don't split between an assistant tool_use and its
      // matching tool_result — the API rejects orphan tool_use blocks.
      // Walk forward to the next safe boundary (after a user/tool_result).
      // NOTE: When the split falls inside a multi-message turn (assistant
      // tool_use followed by user tool_result), we walk past the tool_result
      // to avoid orphaning. Any tool context that spans the split boundary
      // gets a brief note in the compaction summary (the summarizer sees
      // the full older messages including these tool exchanges).
      let split = i + 1;
      while (split < messages.length) {
        const m = messages[split];
        if (
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((c) => "type" in c && c.type === "tool_result")
        ) {
          split += 1;
          continue;
        }
        // Also skip past an assistant message whose content is entirely
        // tool_use blocks — these are the "call" half of a tool turn and
        // must not be orphaned from their results.
        if (
          m.role === "assistant" &&
          Array.isArray(m.content) &&
          m.content.length > 0 &&
          m.content.every((c) => "type" in c && c.type === "tool_use")
        ) {
          split += 1;
          continue;
        }
        break;
      }
      return Math.min(split, messages.length);
    }
    kept += msgTokens;
  }
  return 0;
}

export type CompactResult = {
  before: number;
  after: number;
  summarizedCount: number;
  newMessages: Message[];
};

// Build a map from tool_use_id → tool name by scanning assistant messages.
// Used by prePruneToolOutputs to decide whether a tool_result should be preserved.
function buildToolUseIdMap(messages: Message[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (
        "type" in block &&
        block.type === "tool_use" &&
        "id" in block &&
        "name" in block
      ) {
        map.set(
          (block as { id: string }).id,
          (block as { name: string }).name,
        );
      }
    }
  }
  return map;
}

// Pre-prune: replace old tool_result content with a placeholder.
// Only touches messages before splitAt — the retained "recent" slice is
// never modified. Round-5 P2 fix: boundary was messages.length-based,
// which could prune tool outputs inside the retained slice.
// Tools with preserveOnCompact=true are kept verbatim (e.g. memory recalls,
// wiki reads) since their content is valuable context for the agent.
function prePruneToolOutputs(messages: Message[], splitAt: number): Message[] {
  if (splitAt <= 0) return messages;
  const toolIdMap = buildToolUseIdMap(messages.slice(0, splitAt));
  return messages.map((m, i) => {
    if (i >= splitAt) return m; // retained verbatim — don't touch
    if (m.role !== "user") return m;
    if (typeof m.content === "string") return m;
    if (!Array.isArray(m.content)) return m;
    // Check if it's a tool_result array
    const hasToolResult = m.content.some(
      (b) => "type" in b && b.type === "tool_result",
    );
    if (!hasToolResult) return m;
    // Replace tool_result content with placeholder, unless the originating
    // tool has preserveOnCompact=true.
    return {
      ...m,
      content: m.content.map((b) => {
        if ("type" in b && b.type === "tool_result") {
          const toolUseId = "tool_use_id" in b ? (b as { tool_use_id: string }).tool_use_id : "";
          const toolName = toolIdMap.get(toolUseId) ?? "";
          if (toolName && isToolPreserved(toolName)) {
            return b; // keep verbatim — this tool's output is worth preserving
          }
          return { ...b, content: PRUNED_PLACEHOLDER };
        }
        return b;
      }),
    } as Message;
  });
}

// Incremental summary state. Hermes/OpenClaw/IN7PM all preserve the previous
// summary and UPDATE it rather than rewriting from scratch. This prevents
// information loss across multiple compactions in a single long cycle.
// The state lives for the lifetime of one cycle (reset when cycle ends).
let _previousSummary: string | null = null;

export function resetCompactionState(): void {
  _previousSummary = null;
}

// Contemplative summary template — our equivalent of IN7PM's structured
// Goal/Progress/Decisions template but for a self-discovering agent.
const FRESH_SUMMARY_PROMPT = `The agent is mid-cycle and the conversation has grown long.
Below is the older portion of its inner messages. Summarize it using this structure:

## Thread
What line of thought was the agent following? What question was it pursuing?

## Shifts
Did anything change in the agent's self-understanding? What moved?

## Open questions
What remains unanswered or unresolved?

## Mood
What is the emotional/tonal quality of the thinking so far?

## Actions taken
What tools were called and what files/memories were touched? List the key actions briefly.

Write in the agent's own first-person voice. Be terse but faithful.
This summary will replace the older messages so the agent can continue without forgetting.`;

const UPDATE_SUMMARY_PROMPT = `The agent's conversation has grown long again. Below are NEW messages since the last compaction.
A previous summary exists — UPDATE it, don't rewrite from scratch.

Rules:
- PRESERVE all information from the previous summary
- ADD new shifts, questions, and mood changes from the new messages
- UPDATE the Thread if the direction changed
- Move answered questions out of Open questions
- Keep the same 5-section structure (Thread / Shifts / Open questions / Mood / Actions taken)
- APPEND new tool calls and file/memory touches to the Actions taken section

Write in the agent's own first-person voice.`;

export async function compactIfNeeded(
  messages: Message[],
  systemPromptForContext: string,
  options?: {
    reservedCompletionTokens?: number;
  },
): Promise<CompactResult | null> {
  const provider = resolveProviderConfig().provider;
  const totalTokens = estimateTokens(messages);
  const systemPromptTokens = estimateTextTokens(systemPromptForContext);
  const reservedCompletionTokens = options?.reservedCompletionTokens ?? 4096;
  const estimatedRequestTokens =
    totalTokens + systemPromptTokens + reservedCompletionTokens;

  const { triggerTokens, keepRecentTokens } = getContextBudget();
  const shouldCompact = estimatedRequestTokens >= triggerTokens;

  if (!shouldCompact) return null;
  if (messages.length < 4) {
    return null;
  }

  const splitAt = findSplit(messages, keepRecentTokens);
  if (splitAt < 2) return null;

  // Pre-prune old tool outputs before LLM summarization (Hermes pattern).
  const pruned = prePruneToolOutputs(messages, splitAt);
  const older = pruned.slice(0, splitAt);
  const recent = pruned.slice(splitAt);

  // Extract tool actions from older messages before they are summarized,
  // so the LLM can populate the "## Actions taken" section.
  const toolActionsSummary = extractToolActions(older);

  // Build the prompt — incremental if we have a previous summary, fresh otherwise.
  const isIncremental = _previousSummary !== null;
  const promptParts = [
    isIncremental ? UPDATE_SUMMARY_PROMPT : FRESH_SUMMARY_PROMPT,
  ];
  if (isIncremental) {
    promptParts.push(
      "",
      "--- previous summary ---",
      _previousSummary!,
      "--- end previous summary ---",
    );
  }
  promptParts.push(
    "",
    "--- tool actions in these messages ---",
    toolActionsSummary,
    "--- end tool actions ---",
    "",
    "--- older messages ---",
    messagesAsText(older),
    "--- end ---",
  );

  const result = await think({
    systemPrompt: systemPromptForContext,
    messages: [{ role: "user", content: promptParts.join("\n") }],
    maxTokens: 1536,
  });

  const summaryText = result.text.trim();
  // Save for next compaction within this cycle.
  _previousSummary = summaryText;

  const synthetic: Message = {
    role: "user",
    content: `[earlier in this cycle, you thought:]\n\n${summaryText}`,
  };

  const newMessages: Message[] = [synthetic, ...recent];

  const compactResult: CompactResult = {
    before: totalTokens,
    after: estimateTokens(newMessages),
    summarizedCount: older.length,
    newMessages,
  };

  try {
    await logSystem({
      ts: new Date().toISOString(),
      event: "compaction",
      before: compactResult.before,
      after: compactResult.after,
      summarizedCount: compactResult.summarizedCount,
    });
  } catch {
    // logging must never crash the caller
  }

  return compactResult;
}
