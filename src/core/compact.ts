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
// Only touches messages in the first (older) half — recent ones stay intact.
function prePruneToolOutputs(messages: Message[]): Message[] {
  if (messages.length <= PRUNE_AFTER_TURNS * 2) return messages;
  const boundary = messages.length - PRUNE_AFTER_TURNS * 2;
  return messages.map((m, i) => {
    if (i >= boundary) return m; // recent — don't touch
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
  const pruned = prePruneToolOutputs(messages);
  const older = pruned.slice(0, splitAt);
  const recent = pruned.slice(splitAt);

  const summaryPrompt = [
    "The agent is mid-cycle and the conversation has grown long.",
    "Below is the older half of its inner messages. Summarize it as one short paragraph in the agent's own first-person voice — what it thought, what it learned, what it set in motion.",
    "Be terse but faithful. The summary will replace these messages so the agent can continue without forgetting them entirely.",
    "",
    "--- older messages ---",
    messagesAsText(older),
    "--- end ---",
  ].join("\n");

  const result = await think({
    systemPrompt: systemPromptForContext,
    messages: [{ role: "user", content: summaryPrompt }],
    maxTokens: 1024,
  });

  const synthetic: Message = {
    role: "user",
    content: `[earlier in this cycle, you thought:]\n\n${result.text.trim()}`,
  };

  const newMessages: Message[] = [synthetic, ...recent];

  return {
    before: totalTokens,
    after: estimateTokens(newMessages),
    summarizedCount: older.length,
    newMessages,
  };
}
