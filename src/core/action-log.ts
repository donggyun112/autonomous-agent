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

// Molt success rate — from lineage.md parsing. Hyperagents imp@k concept.
export async function moltStats(): Promise<{
  totalMolts: number;
  // We don't track rejections in lineage (only successful molts are recorded).
  // This counts successful molts. Rejected molts are in generations/ with
  // no corresponding lineage entry.
}> {
  const { LINEAGE } = await import("../primitives/paths.js");
  try {
    const text = await readFile(LINEAGE, "utf-8");
    const moltLines = text.split("\n").filter((l) => l.startsWith("- **"));
    return { totalMolts: moltLines.length };
  } catch {
    return { totalMolts: 0 };
  }
}
