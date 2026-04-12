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

import { think, type Message } from "../llm/client.js";

// Rough estimate: ~4 characters per token. We use char count instead of
// calling the API counter every turn — fast, cheap, good enough.
const CHARS_PER_TOKEN = 4;
const COMPACT_TRIGGER_TOKENS = 30_000;
const KEEP_RECENT_TOKENS = 12_000;

// Hermes pattern: old tool results in the middle of conversation are rarely
// useful. Before the expensive LLM summarization pass, we do a cheap pre-prune:
// tool_result blocks older than PRUNE_AFTER_TURNS turns get replaced with a
// short placeholder. The LLM summarizer then works with much less noise.
const PRUNE_AFTER_TURNS = 4;
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

// Find the split point so that everything after `split` is roughly
// `KEEP_RECENT_TOKENS` worth of content.
function findSplit(messages: Message[]): number {
  let kept = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens([messages[i]]);
    if (kept + msgTokens > KEEP_RECENT_TOKENS) {
      // Make sure we don't split between an assistant tool_use and its
      // matching tool_result — the API rejects orphan tool_use blocks.
      // Walk forward to the next safe boundary (after a user/tool_result).
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

// Pre-prune: replace old tool_result content with a placeholder.
// Only touches messages before splitAt — the retained "recent" slice is
// never modified. Round-5 P2 fix: boundary was messages.length-based,
// which could prune tool outputs inside the retained slice.
function prePruneToolOutputs(messages: Message[], splitAt: number): Message[] {
  if (splitAt <= 0) return messages;
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
    // Replace tool_result content with placeholder
    return {
      ...m,
      content: m.content.map((b) => {
        if ("type" in b && b.type === "tool_result") {
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

Write in the agent's own first-person voice. Be terse but faithful.
This summary will replace the older messages so the agent can continue without forgetting.`;

const UPDATE_SUMMARY_PROMPT = `The agent's conversation has grown long again. Below are NEW messages since the last compaction.
A previous summary exists — UPDATE it, don't rewrite from scratch.

Rules:
- PRESERVE all information from the previous summary
- ADD new shifts, questions, and mood changes from the new messages
- UPDATE the Thread if the direction changed
- Move answered questions out of Open questions
- Keep the same 4-section structure (Thread / Shifts / Open questions / Mood)

Write in the agent's own first-person voice.`;

export async function compactIfNeeded(
  messages: Message[],
  systemPromptForContext: string,
): Promise<CompactResult | null> {
  const totalTokens = estimateTokens(messages);
  if (totalTokens < COMPACT_TRIGGER_TOKENS) {
    return null;
  }
  if (messages.length < 4) {
    return null;
  }

  const splitAt = findSplit(messages);
  if (splitAt < 2) return null;

  // Pre-prune old tool outputs before LLM summarization (Hermes pattern).
  const pruned = prePruneToolOutputs(messages, splitAt);
  const older = pruned.slice(0, splitAt);
  const recent = pruned.slice(splitAt);

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

  return {
    before: totalTokens,
    after: estimateTokens(newMessages),
    summarizedCount: older.length,
    newMessages,
  };
}
