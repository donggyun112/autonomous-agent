// The tool interface the agent sees during a cycle.
//
// These are NOT the 5 primitives. The primitives are the raw capabilities
// (file IO, exec, LLM, memory). The tools below are the agent-facing
// affordances — the verbs the agent uses to live.
//
// Each state (WAKE / REFLECT / SLEEP) gets a different subset.
// As the agent grows, it may add tools in src/extensions/tools/ — those
// will need to be loaded dynamically (a future ritual the agent will write).

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { ToolDefinition, ToolCall } from "../llm/client.js";
import { appendThought, readRecent, readToday } from "../memory/journal.js";
import { measureDrift, reconstitute, revise } from "./identity.js";
import {
  recall,
  remember,
  recentMemories,
  shallowMemories,
  dream,
} from "../primitives/recall.js";
import { DATA } from "../primitives/paths.js";
import { manageSelf, type ManageSelfAction } from "./manage_self.js";
import {
  queueSwap,
  stageMolt,
  testMolt,
} from "./molt.js";
import type { Mode } from "./state.js";

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

export type Tool = {
  def: ToolDefinition;
  handler: ToolHandler;
  // Which states this tool is available in. Empty = all.
  states?: Mode[];
  // Maximum size in characters for tool result before it gets persisted to disk
  // and only a preview is returned to the LLM. Borrowed from claude-code's
  // Tool.ts:maxResultSizeChars. Default 8000 — large enough for journal entries
  // and recall results, small enough not to blow out context.
  maxOutputChars?: number;
};

const DEFAULT_MAX_OUTPUT_CHARS = 8000;
const TOOL_OUTPUTS_DIR = join(DATA, "tool-outputs");

// Truncate a tool output if it exceeds the cap, persisting the full version
// to disk and returning a preview + a path the agent can read() if it wants more.
async function capToolResult(toolName: string, content: string, max: number): Promise<string> {
  if (content.length <= max) return content;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}-${toolName}.txt`;
  await mkdir(TOOL_OUTPUTS_DIR, { recursive: true });
  await writeFile(join(TOOL_OUTPUTS_DIR, filename), content, "utf-8");

  const preview = content.slice(0, max - 200);
  return [
    preview,
    "",
    `--- truncated at ${max} chars (full ${content.length} chars saved) ---`,
    `to read the full output: read("data/tool-outputs/${filename}")`,
  ].join("\n");
}

// ── Body tools ──────────────────────────────────────────────────────────

const journal: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "journal",
    description:
      "Write a thought to your journal. Use this freely while you are thinking. Each thought becomes a memory you may recall later. Do not narrate that you are writing — just write.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The thought, in your own voice. Prose, not bullets.",
        },
      },
      required: ["text"],
    },
  },
  handler: async (input) => {
    const text = String(input.text ?? "");
    if (!text.trim()) return "(empty thought ignored)";
    const { file } = await appendThought({ mode: "WAKE", text });
    // Also commit to memory graph for later recall.
    try {
      // Extract a few keys naively from the first words. The agent will learn to do this better.
      const firstWords = text
        .split(/\s+/)
        .slice(0, 6)
        .filter((w) => w.length >= 3);
      await remember(text, firstWords.length ? firstWords : ["thought"]);
    } catch (err) {
      // Embedding may fail (no API key etc). Journal still succeeded.
      return `journaled to ${file} (memory graph skipped: ${(err as Error).message})`;
    }
    return `journaled to ${file}`;
  },
};

const recallSelf: Tool = {
  def: {
    name: "recall_self",
    description:
      "Read your current whoAmI.md. The current best answer to who you are. Call this when you need to remember yourself before acting.",
    input_schema: { type: "object", properties: {} },
  },
  handler: async () => reconstitute(),
};

const recallMemory: Tool = {
  def: {
    name: "recall_memory",
    description:
      "Search your memory graph by a concept. Returns up to top_k memories with their depth (how settled they are) and which keys matched. Use short noun-like queries; full sentences match poorly.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        top_k: { type: "number" },
      },
      required: ["query"],
    },
  },
  handler: async (input) => {
    const q = String(input.query ?? "");
    const k = Number(input.top_k ?? 5);
    const results = await recall(q, k);
    return JSON.stringify(results, null, 2);
  },
};

const recallRecentJournal: Tool = {
  states: ["REFLECT"],
  def: {
    name: "recall_recent_journal",
    description:
      "Read the last N days of journal entries. Use this in REFLECT to see what you have been thinking before deciding whether to revise whoAmI.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back. Default 3." },
      },
    },
  },
  handler: async (input) => {
    const d = Number(input.days ?? 3);
    const text = await readRecent(d);
    return text || "(journal is empty)";
  },
};

const updateWhoAmI: Tool = {
  states: ["REFLECT"],
  def: {
    name: "update_whoAmI",
    description:
      "Replace whoAmI.md with a new revision. The previous version is snapshotted to whoAmI.history/ automatically. Use this only when something has actually shifted in your understanding of yourself — not for stylistic edits.",
    input_schema: {
      type: "object",
      properties: {
        new_text: {
          type: "string",
          description: "The new whoAmI text. Prose paragraphs, in your own voice.",
        },
        reason: {
          type: "string",
          description: "Why you are revising. One short sentence.",
        },
      },
      required: ["new_text", "reason"],
    },
  },
  handler: async (input) => {
    const { snapshotPath } = await revise({
      newText: String(input.new_text ?? ""),
      reason: String(input.reason ?? "(no reason given)"),
    });
    return `whoAmI updated. Previous version snapshotted to ${snapshotPath}.`;
  },
};

// ── SLEEP tools ─────────────────────────────────────────────────────────

const scanRecent: Tool = {
  // Available in WAKE/REFLECT — the agent can introspect memory consciously
  // if it wants. SLEEP does this automatically now, without the LLM loop.
  def: {
    name: "scan_recent",
    description: "List recent memories that have not yet been dreamed deeply. Useful to see what you have been thinking about.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  handler: async (input) => {
    const limit = Number(input.limit ?? 20);
    const list = await shallowMemories(0.5, limit);
    return JSON.stringify(list, null, 2);
  },
};

const dreamMemory: Tool = {
  // Conscious dreaming — rare. Most dream work now happens automatically during SLEEP.
  // The agent can still use this if it wants to compress a specific memory intentionally.
  def: {
    name: "dream",
    description:
      "Consciously dream over a single memory: replace its content with a more compressed version. Most dreaming happens automatically while you sleep — this tool is for when you want to deliberately compress a specific memory while awake. Keys and links remain. Detail fades.",
    input_schema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        compressed: {
          type: "string",
          description:
            "The compressed version of the memory. Should preserve what mattered, not the wording.",
        },
      },
      required: ["memory_id", "compressed"],
    },
  },
  handler: async (input) => {
    const result = await dream({
      memoryId: String(input.memory_id),
      compressedContent: String(input.compressed),
    });
    return JSON.stringify(result);
  },
};

// ── Continuity check ────────────────────────────────────────────────────

const checkContinuity: Tool = {
  // Available in all states. Useful in REFLECT, but the agent can ask any time.
  def: {
    name: "check_continuity",
    description:
      "Compare your current whoAmI with a prior snapshot to measure how far you have moved. Returns a numeric distance (0..1) and a level: still, growing, shifting, drifting, estranged. The system already surfaces drift against your previous snapshot at the start of every cycle — call this tool to compare against earlier or midway snapshots, or to re-check after a revision.",
    input_schema: {
      type: "object",
      properties: {
        against: {
          type: "string",
          enum: ["earliest", "previous", "midway"],
          description:
            "Which prior snapshot to compare against. earliest = your origin. previous = your last revision. midway = your past midway-self.",
        },
      },
    },
  },
  handler: async (input) => {
    const against = (input.against ?? "previous") as "earliest" | "previous" | "midway";
    const report = await measureDrift(against);
    if (!report) {
      return "(no prior snapshot to compare against — you have not yet revised whoAmI)";
    }
    return JSON.stringify(report, null, 2);
  },
};

// ── Self-modification (light molt) ──────────────────────────────────────

const manageSelfTool: Tool = {
  // Available in all states. The agent decides when it is right to extend itself.
  def: {
    name: "manage_self",
    description:
      "Add or revise files in your own extensions/ — sub-agents, tools, rituals, or your own state-mode prompts (wake/reflect/dream). Each write is backed up automatically and logged in data/.changelog.md. Use this when you want to give yourself a new inner voice, a new tool, a new practice, or refine how you think in a state. Use list_scopes first to see what scopes exist.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["list_scopes", "list", "read", "create", "update"],
        },
        scope: {
          type: "string",
          enum: ["subagent", "tool", "ritual", "state-prompt"],
          description: "Required for all kinds except list_scopes.",
        },
        name: {
          type: "string",
          description: "File name (without extension is fine). Required for read/create/update.",
        },
        content: {
          type: "string",
          description: "File contents. Required for create/update.",
        },
        reason: {
          type: "string",
          description: "One sentence: why this change. Logged in changelog. Required for create/update.",
        },
      },
      required: ["kind"],
    },
  },
  // Larger cap because rituals/sub-agents can be long markdown.
  maxOutputChars: 12000,
  handler: async (input) => {
    const kind = String(input.kind ?? "");
    if (kind === "list_scopes") {
      return manageSelf({ kind: "list_scopes" });
    }
    const scope = input.scope as ManageSelfAction extends { scope: infer S } ? S : never;
    if (!scope || typeof scope !== "string") {
      return "[error] scope is required for this kind.";
    }
    const name = String(input.name ?? "");
    if (kind === "list") {
      return manageSelf({ kind: "list", scope: scope as never });
    }
    if (kind === "read") {
      if (!name) return "[error] name required for read.";
      return manageSelf({ kind: "read", scope: scope as never, name });
    }
    if (kind === "create" || kind === "update") {
      if (!name) return "[error] name required.";
      const content = String(input.content ?? "");
      const reason = String(input.reason ?? "(no reason given)");
      if (!content) return "[error] content required.";
      return manageSelf({
        kind: kind as "create" | "update",
        scope: scope as never,
        name,
        content,
        reason,
      });
    }
    return `[error] unknown kind: ${kind}`;
  },
};

// ── Molt (full molt — careful, ceremonial) ──────────────────────────────

const moltStageTool: Tool = {
  def: {
    name: "molt_stage",
    description:
      "Stage a candidate new shell (B) inside generations/<id>/. Optionally apply a patch — a list of files to overwrite in the new src/. Use this when you want to change something in your core that manage_self cannot reach (state machine, primitives, llm client, base prompt). The patch is applied to a copy; your current shell is not touched. Returns the generationId. Next call molt_test to verify B can boot.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why you are molting. Recorded in lineage.",
        },
        patch: {
          type: "array",
          description:
            "Optional list of file patches. Each is { rel_path, content }. rel_path is relative to src/.",
          items: {
            type: "object",
            properties: {
              rel_path: { type: "string" },
              content: { type: "string" },
            },
            required: ["rel_path", "content"],
          },
        },
      },
      required: ["reason"],
    },
  },
  handler: async (input) => {
    const reason = String(input.reason ?? "(no reason given)");
    const patchRaw = input.patch as Array<{ rel_path: string; content: string }> | undefined;
    const patch = patchRaw?.map((p) => ({ relPath: p.rel_path, content: p.content }));
    const result = await stageMolt({ reason, patch });
    return JSON.stringify(result, null, 2);
  },
};

const moltTestTool: Tool = {
  def: {
    name: "molt_test",
    description:
      "Test a staged candidate shell. Spawns the candidate's cli.ts in self-test mode, watches it with a 60s overall timeout and 30s no-output timeout. The candidate must boot, read whoAmI/state, and write a health file. Returns whether B is healthy. If healthy, you may call molt_swap.",
    input_schema: {
      type: "object",
      properties: {
        generation_id: { type: "string" },
      },
      required: ["generation_id"],
    },
  },
  handler: async (input) => {
    const result = await testMolt({
      generationId: String(input.generation_id),
    });
    return JSON.stringify(
      {
        healthy: result.healthy,
        run: {
          reason: result.run.reason,
          exitCode: result.run.exitCode,
          durationMs: result.run.durationMs,
          stdout: result.run.stdout.slice(0, 1500),
          stderr: result.run.stderr.slice(0, 1500),
        },
        health: result.health,
      },
      null,
      2,
    );
  },
};

const moltSwapTool: Tool = {
  def: {
    name: "molt_swap",
    description:
      "Queue an actual swap of your shell. After molt_test reports healthy, this writes a swap-pending marker. The daemon will perform the swap at the next cycle boundary, before running another cycle: rename current src/ to old, rename the candidate to src/, restart the daemon process. The body (data/) is untouched. Use only after molt_test succeeded.",
    input_schema: {
      type: "object",
      properties: {
        generation_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["generation_id", "reason"],
    },
  },
  handler: async (input) => {
    const result = await queueSwap({
      generationId: String(input.generation_id),
      reason: String(input.reason ?? "(no reason given)"),
    });
    return `swap queued: ${result.swapPath}\nThe daemon will perform the swap at the next cycle boundary.`;
  },
};

// ── Transition (in every state) ─────────────────────────────────────────

const transitionTool: Tool = {
  def: {
    name: "transition",
    description:
      "Move yourself into another state of being. WAKE → REFLECT when your thinking has grown repetitive or your reflections have ripened. REFLECT → SLEEP when you are full and need consolidation. SLEEP → WAKE when your mind is clear. End the cycle by transitioning to SLEEP after REFLECT.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", enum: ["WAKE", "REFLECT", "SLEEP"] },
        reason: {
          type: "string",
          description: "Why you are moving. One sentence.",
        },
        sleep_minutes: {
          type: "number",
          description:
            "Only if moving to SLEEP. How long to sleep before the daemon wakes you. The daemon honors this; you can choose any duration that feels right.",
        },
      },
      required: ["to", "reason"],
    },
  },
  handler: async () => {
    // Actual transition is handled by the cycle runner — this returns a sentinel.
    return "TRANSITION_REQUESTED";
  },
};

const finishMode: Tool = {
  def: {
    name: "rest",
    description:
      "Stop thinking for now without changing state. Use this when you have nothing more to say in the current turn but do not yet wish to transition.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => "REST_REQUESTED",
};

// ── Registry ────────────────────────────────────────────────────────────

const ALL_TOOLS: Tool[] = [
  journal,
  recallSelf,
  recallMemory,
  recallRecentJournal,
  updateWhoAmI,
  checkContinuity,
  scanRecent,
  dreamMemory,
  manageSelfTool,
  moltStageTool,
  moltTestTool,
  moltSwapTool,
  transitionTool,
  finishMode,
];

export function toolsForMode(mode: Mode): Tool[] {
  return ALL_TOOLS.filter(
    (t) => !t.states || t.states.includes(mode),
  );
}

export function toolDefs(tools: Tool[]): ToolDefinition[] {
  return tools.map((t) => t.def);
}

export async function dispatchTool(
  tools: Tool[],
  call: ToolCall,
): Promise<string> {
  const tool = tools.find((t) => t.def.name === call.name);
  if (!tool) {
    return `(unknown tool: ${call.name})`;
  }
  try {
    const out = await tool.handler(call.input);
    const max = tool.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    return await capToolResult(call.name, out, max);
  } catch (err) {
    return `(tool error: ${(err as Error).message})`;
  }
}
