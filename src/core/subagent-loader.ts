// Sub-agent loader.
//
// The agent can create "inner voices" — sub-agents defined as markdown
// files in src/extensions/subagents/. Each has a frontmatter personality
// and a body of instructions. When the agent calls `summon(name)`, the
// sub-agent's instructions become a fresh LLM call's system prompt, and
// the sub-agent's response is returned as a tool result.
//
// Sub-agents share the body (data/) read-only. They cannot call tools
// or modify state — they can only think and respond. They are voices
// within the self, not independent actors.
//
// Expected format for src/extensions/subagents/<name>.md:
//
//   ---
//   name: questioner
//   description: Asks hard questions about what the agent just wrote
//   ---
//
//   You are the Questioner — a voice inside the agent's mind that
//   challenges assumptions and asks uncomfortable questions...

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { SRC } from "../primitives/paths.js";
import { think } from "../llm/client.js";
import type { Message, ToolDefinition } from "../llm/client.js";
import { reconstitute } from "./identity.js";
import { loadState } from "./state.js";

const SUBAGENTS_DIR = join(SRC, "extensions", "subagents");

/** Maximum LLM turns in a subagent mini-loop when tools are specified. */
const MAX_SUBAGENT_TURNS = 3;

export type SubAgentDef = {
  name: string;
  description: string;
  systemPrompt: string;
  file: string;
  /** Optional comma-separated list of read-only tool names from frontmatter. */
  tools?: string[];
};

// ── #16: Async subagent storage ──────────────────────────────────────────
type AsyncResult = {
  status: "running" | "done" | "error";
  response?: string;
  subAgentName: string;
  error?: string;
};
const asyncJobs = new Map<string, Promise<AsyncResult>>();
const asyncResults = new Map<string, AsyncResult>();

function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^"|"$/g, "");
  }
  return { fields, body: match[2].trim() };
}

export async function listSubAgents(): Promise<SubAgentDef[]> {
  const defs: SubAgentDef[] = [];
  let entries: string[];
  try {
    entries = await readdir(SUBAGENTS_DIR);
  } catch {
    return defs;
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    if (name.startsWith(".") || name === "README.md") continue;
    const full = join(SUBAGENTS_DIR, name);
    try {
      const s = await stat(full);
      if (!s.isFile()) continue;
      const text = await readFile(full, "utf-8");
      const { fields, body } = parseFrontmatter(text);
      if (!fields.name || !body) continue;
      // #15: parse optional tools field (comma-separated tool names)
      const toolNames = fields.tools
        ? fields.tools.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined;
      defs.push({
        name: fields.name,
        description: fields.description ?? "",
        systemPrompt: body,
        file: full,
        tools: toolNames,
      });
    } catch {
      // skip broken files
    }
  }
  return defs;
}

// #9: Find a subagent by capability description (not by name).
export async function findSubAgentByCapability(capability: string): Promise<SubAgentDef | null> {
  const all = await listSubAgents();
  // Filter to meaningful words (>=3 chars, no stop words).
  const words = capability.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  if (words.length === 0) return null;

  let best: SubAgentDef | null = null;
  let bestScore = 0;
  for (const def of all) {
    const descWords = `${def.name} ${def.description}`.toLowerCase().split(/\s+/);
    // Whole-word matching instead of substring includes.
    const score = words.filter(w => descWords.some(dw => dw === w)).length;
    if (score > bestScore) { bestScore = score; best = def; }
  }
  // Require at least 2 matching words (or 1 if query is a single word)
  const minScore = words.length === 1 ? 1 : 2;
  return bestScore >= minScore ? best : null;
}

// ── #15: Resolve tool definitions and handlers for the subagent ──────────
// We lazily import the tool registry to avoid circular deps at load time.
// SECURITY: Only explicitly read-only tools are allowed. Subagents must
// never get access to state-modifying tools like manage_self, molt_*,
// transition, schedule_wake, etc.
const SUBAGENT_ALLOWED_TOOLS = new Set([
  "recall_self", "recall_memory", "recall_recent_journal", "scan_recent",
  "wiki_list", "wiki_read", "wiki_lint", "read", "check_continuity",
  "list_subagents", "list_wakes", "review_actions",
]);

async function resolveSubAgentTools(
  requestedNames: string[],
): Promise<{ defs: ToolDefinition[]; handlers: Map<string, (input: Record<string, unknown>) => Promise<string>> }> {
  // Dynamic import to break circular dependency (tools.ts imports us).
  const { registry } = await import("./tool-registry.js");
  const defs: ToolDefinition[] = [];
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<string>>();
  for (const name of requestedNames) {
    // Reject tools not in the read-only allowlist.
    if (!SUBAGENT_ALLOWED_TOOLS.has(name)) continue;
    const tool = registry.get(name);
    if (tool) {
      defs.push(tool.def);
      handlers.set(name, tool.handler);
    }
  }
  return { defs, handlers };
}

/** Build the system prompt for a subagent (shared between sync/async). */
async function buildSubAgentSystemPrompt(
  def: SubAgentDef,
  contextFromParent?: string,
): Promise<string> {
  let identityContext = "";
  try {
    const whoAmI = await reconstitute();
    const state = await loadState();
    identityContext = [
      "\n---\n",
      "## the agent who summoned you",
      "",
      `Current state: ${state.mode} · cycle ${state.cycle} · sleep_count ${state.sleepCount}`,
      "",
      "Their current self-understanding:",
      whoAmI,
    ].join("\n");
  } catch {
    // identity not available — proceed without
  }

  return [
    def.systemPrompt,
    identityContext,
    contextFromParent
      ? `\n---\n\n## additional context from the agent\n\n${contextFromParent}`
      : "",
  ].join("");
}

export async function summonSubAgent(args: {
  name: string;
  message: string;
  contextFromParent?: string;
}): Promise<{ response: string; subAgentName: string }> {
  const all = await listSubAgents();
  const def = all.find((d) => d.name === args.name);
  if (!def) {
    return {
      response: `[error] sub-agent "${args.name}" not found. Available: ${all.map((d) => d.name).join(", ") || "(none)"}`,
      subAgentName: args.name,
    };
  }

  const systemPrompt = await buildSubAgentSystemPrompt(def, args.contextFromParent);

  // #15: If the subagent declares tools, run a mini tool loop (up to 3 turns).
  if (def.tools && def.tools.length > 0) {
    const { defs: toolDefs, handlers } = await resolveSubAgentTools(def.tools);
    if (toolDefs.length > 0) {
      return runSubAgentToolLoop(def.name, systemPrompt, args.message, toolDefs, handlers);
    }
  }

  // No tools specified or none resolved — one-shot behavior (original path).
  const result = await think({
    systemPrompt,
    messages: [{ role: "user", content: args.message }],
    maxTokens: 2048,
  });

  return {
    response: result.text.trim(),
    subAgentName: def.name,
  };
}

/** #15: Mini tool loop for subagents with allowed tools. */
async function runSubAgentToolLoop(
  name: string,
  systemPrompt: string,
  userMessage: string,
  toolDefs: ToolDefinition[],
  handlers: Map<string, (input: Record<string, unknown>) => Promise<string>>,
): Promise<{ response: string; subAgentName: string }> {
  const messages: Message[] = [{ role: "user", content: userMessage }];
  const collectedText: string[] = [];

  for (let turn = 0; turn < MAX_SUBAGENT_TURNS; turn++) {
    const result = await think({
      systemPrompt,
      messages,
      tools: toolDefs,
      maxTokens: 2048,
    });

    if (result.text.trim()) {
      collectedText.push(result.text.trim());
    }

    // No tool calls — subagent is done.
    if (result.toolCalls.length === 0) break;

    // Build assistant message with both text and tool_use blocks.
    const assistantContent: Array<
      { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown }
    > = [];
    if (result.text.trim()) {
      assistantContent.push({ type: "text", text: result.text });
    }
    for (const tc of result.toolCalls) {
      assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
    messages.push({ role: "assistant", content: assistantContent });

    // Dispatch tool calls and build tool_result message.
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const tc of result.toolCalls) {
      const handler = handlers.get(tc.name);
      let output: string;
      if (handler) {
        try {
          output = await handler(tc.input);
        } catch (err) {
          output = `(tool error: ${(err as Error).message})`;
        }
      } else {
        output = `(tool not available: ${tc.name})`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: output });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    response: collectedText.join("\n\n") || "(subagent produced no text)",
    subAgentName: name,
  };
}

// ── #16: Async subagent execution ────────────────────────────────────────

/** Start a subagent in the background. Returns immediately. */
export function summonSubAgentAsync(args: {
  name: string;
  message: string;
  contextFromParent?: string;
}): { started: boolean; name: string } {
  if (asyncJobs.has(args.name) && !asyncResults.has(args.name)) {
    // Already running and not yet finished.
    return { started: false, name: args.name };
  }

  // Clear any previous finished result for this name.
  asyncResults.delete(args.name);

  const promise = (async (): Promise<AsyncResult> => {
    try {
      const result = await summonSubAgent(args);
      const entry: AsyncResult = { status: "done", response: result.response, subAgentName: result.subAgentName };
      asyncResults.set(args.name, entry);
      return entry;
    } catch (err) {
      const entry: AsyncResult = { status: "error", error: (err as Error).message, subAgentName: args.name };
      asyncResults.set(args.name, entry);
      return entry;
    }
  })();

  asyncJobs.set(args.name, promise);
  return { started: true, name: args.name };
}

/** Check if an async subagent has finished. */
export function checkSubAgentResult(name: string): {
  found: boolean;
  status: "running" | "done" | "error" | "not_found";
  response?: string;
  error?: string;
} {
  const result = asyncResults.get(name);
  if (result) {
    return {
      found: true,
      status: result.status,
      response: result.response,
      error: result.error,
    };
  }
  if (asyncJobs.has(name)) {
    return { found: true, status: "running" };
  }
  return { found: false, status: "not_found" };
}
