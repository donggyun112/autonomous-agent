// Action log — records every tool call the agent makes.
//
// Hyperagents (Meta AI) found that the FIRST thing self-improving agents
// spontaneously create is logging infrastructure. Without a record of what
// was done, the agent cannot identify patterns, diagnose failures, or
// measure whether its modifications actually helped.
//
// journal/ records THOUGHTS. action-log records ACTIONS.
// Together they give the agent a complete picture of its own behavior.
//
// Format: JSONL append-only, one line per tool call. Daily files.
// The agent can read these via the read tool or a future analysis extension.

import { appendFile, mkdir, readFile, readdir } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";

const LOG_DIR = join(DATA, "action-log");

export type ActionEntry = {
  ts: string;         // ISO timestamp
  cycle: number;
  mode: string;       // WAKE / REFLECT / SLEEP
  tool: string;       // tool name
  input_summary: string; // first 200 chars of JSON input
  output_summary: string; // first 200 chars of result
  duration_ms: number;
  error?: string;
};

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return join(LOG_DIR, `${yyyy}-${mm}-${dd}.jsonl`);
}

export async function logAction(entry: ActionEntry): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(todayFile(), JSON.stringify(entry) + "\n", "utf-8");
}

// Read recent action logs — for the agent to introspect its own behavior.
export async function readRecentActions(days = 1): Promise<ActionEntry[]> {
  let files: string[];
  try {
    files = (await readdir(LOG_DIR))
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .slice(-days);
  } catch {
    return [];
  }

  const entries: ActionEntry[] = [];
  for (const f of files) {
    try {
      const text = await readFile(join(LOG_DIR, f), "utf-8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as ActionEntry);
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }
  return entries;
}

// Summary stats — for status command and REFLECT introspection.
export async function actionStats(days = 1): Promise<{
  totalCalls: number;
  byTool: Record<string, number>;
  errors: number;
  avgDurationMs: number;
}> {
  const entries = await readRecentActions(days);
  const byTool: Record<string, number> = {};
  let errors = 0;
  let totalDuration = 0;

  for (const e of entries) {
    byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
    if (e.error) errors += 1;
    totalDuration += e.duration_ms;
  }

  return {
    totalCalls: entries.length,
    byTool,
    errors,
    avgDurationMs: entries.length > 0 ? Math.round(totalDuration / entries.length) : 0,
  };
}

// ── Cost tracking per cycle ──────────────────────────────────────────────

export type CycleCostEntry = {
  ts: string;
  cycle: number;
  mode: string;
  inputTokens: number;
  outputTokens: number;
};

// Simple rate table: $/MTok.  Opus = $15/$75, Sonnet = $3/$15.
const COST_RATES: Record<string, { input: number; output: number }> = {
  opus:   { input: 15,  output: 75 },
  sonnet: { input: 3,   output: 15 },
};

function estimateCost(entry: CycleCostEntry): number {
  // Default to Opus pricing (the primary model).
  const rate = COST_RATES.opus;
  return (
    (entry.inputTokens / 1_000_000) * rate.input +
    (entry.outputTokens / 1_000_000) * rate.output
  );
}

const COST_LOG = join(DATA, "cost-log.jsonl");

export async function logCycleCost(entry: CycleCostEntry): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
  const record = {
    ...entry,
    estimatedCostUsd: Number(estimateCost(entry).toFixed(4)),
  };
  await appendFile(COST_LOG, JSON.stringify(record) + "\n", "utf-8");
}

// ── Molt success rate ───────────────────────────────────────────────────
// From lineage.md parsing + generations/ scan. Hyperagents imp@k concept.

export async function moltStats(): Promise<{
  totalMolts: number;
  failedMolts: number;
  successRate: number;
}> {
  const { LINEAGE, GENERATIONS } = await import("../primitives/paths.js");

  let successfulMolts = 0;
  try {
    const text = await readFile(LINEAGE, "utf-8");
    const moltLines = text.split("\n").filter((l) => l.startsWith("- **"));
    successfulMolts = moltLines.length;
  } catch {
    // lineage file may not exist
  }

  // Scan generations/ for directories that don't have a lineage entry.
  let totalGenerations = 0;
  try {
    const entries = await readdir(GENERATIONS, { withFileTypes: true });
    totalGenerations = entries.filter((e) => e.isDirectory()).length;
  } catch {
    // generations dir may not exist
  }

  const failedMolts = Math.max(0, totalGenerations - successfulMolts);
  const totalMolts = totalGenerations;
  const successRate = totalMolts > 0 ? successfulMolts / totalMolts : 1;

  return { totalMolts, failedMolts, successRate };
}
