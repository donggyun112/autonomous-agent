// Structured system logging — records system-level events (LLM calls,
// compaction, cycle start/end) to daily JSONL files.
//
// This is NOT the action log (which records tool calls). This is the
// infrastructure layer: how long did the LLM take? How many tokens?
// Did compaction fire? Did the cycle crash?
//
// Design: never crash the caller. Every log call is wrapped in try/catch.
// A logging failure should never take down a cycle.

import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";

const LOG_DIR = join(DATA, "system-log");
let dirCreated = false;

export type SystemLogEntry = {
  ts: string;
  event: string;
  // LLM call fields
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  // Compaction fields
  before?: number;
  after?: number;
  summarizedCount?: number;
  // Cycle fields
  cycle?: number;
  mode?: string;
  reason?: string;
  // Error fields
  error?: string;
  // Generic payload for anything else
  detail?: string;
};

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return join(LOG_DIR, `${yyyy}-${mm}-${dd}.jsonl`);
}

export async function logSystem(entry: SystemLogEntry): Promise<void> {
  try {
    if (!dirCreated) {
      await mkdir(LOG_DIR, { recursive: true });
      dirCreated = true;
    }
    await appendFile(todayFile(), JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // System logging must never crash the caller.
    dirCreated = false; // retry mkdir next time
  }
}
