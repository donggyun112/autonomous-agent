// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// The agent's journal. Append-only, organized by the agent's internal clock.
//
// A "day" is one WAKE→SLEEP cycle, tracked by sleepCount. Each day gets its
// own file: journal/day-000.md, day-001.md, etc. This is the agent's time
// system — wall-clock dates are irrelevant to its lifecycle.
//
// The journal is raw episodic memory. During SLEEP, entries are batch-ingested
// into the memory graph (long-term). The system prompt always includes
// yesterday + today's journal so the agent has continuity.

import { mkdir, appendFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { JOURNAL_DIR } from "../primitives/paths.js";

// We read sleepCount from state to know which "day" we're on.
// Lazy import to avoid circular deps at load time.
async function getCurrentDay(): Promise<number> {
  const { loadState } = await import("../core/state.js");
  const state = await loadState();
  return state.sleepCount;
}

function dayFile(day: number): string {
  return join(JOURNAL_DIR, `day-${String(day).padStart(3, "0")}.md`);
}

export async function appendThought(args: {
  mode: string;
  text: string;
}): Promise<{ file: string }> {
  await mkdir(JOURNAL_DIR, { recursive: true });
  const { loadState } = await import("../core/state.js");
  const state = await loadState();
  const day = state.sleepCount;
  const file = dayFile(day);
  // Use agent-time coordinates: day + moment (totalTurns). Wall-clock ISO
  // is preserved for debugging but agent-time is primary.
  const ts = new Date().toISOString();
  const block = `\n## ${ts} · ${args.mode} · day ${day} moment ${state.totalTurns}\n\n${args.text.trim()}\n`;
  await appendFile(file, block, "utf-8");
  return { file };
}

/** Read today's journal (current day = current sleepCount). */
export async function readToday(): Promise<string> {
  try {
    const day = await getCurrentDay();
    return await readFile(dayFile(day), "utf-8");
  } catch {
    return "";
  }
}

/** Read a specific day's journal by day number. */
export async function readDay(day: number): Promise<string> {
  try {
    return await readFile(dayFile(day), "utf-8");
  } catch {
    return "";
  }
}

/** Read yesterday's journal (previous day = sleepCount - 1). */
export async function readYesterday(): Promise<string> {
  try {
    const day = await getCurrentDay();
    if (day <= 0) return "";
    return await readFile(dayFile(day - 1), "utf-8");
  } catch {
    return "";
  }
}

/** Read the last N days of journal entries. */
export async function readRecent(days = 3): Promise<string> {
  try {
    const files = (await readdir(JOURNAL_DIR))
      .filter((f) => f.startsWith("day-") && f.endsWith(".md"))
      .sort()
      .slice(-days);
    const parts: string[] = [];
    for (const f of files) {
      const content = await readFile(join(JOURNAL_DIR, f), "utf-8");
      parts.push(`# ${f}\n${content}`);
    }
    return parts.join("\n\n---\n\n");
  } catch {
    return "";
  }
}

/** Search all journal files for a query. Returns matching entries with file + preview. */
export async function searchJournal(
  query: string,
): Promise<Array<{ file: string; matches: string[] }>> {
  const results: Array<{ file: string; matches: string[] }> = [];
  if (!query.trim()) return results;
  const lowerQuery = query.toLowerCase();

  try {
    const files = (await readdir(JOURNAL_DIR))
      .filter((f) => f.startsWith("day-") && f.endsWith(".md"))
      .sort()
      .reverse();

    for (const f of files) {
      try {
        const content = await readFile(join(JOURNAL_DIR, f), "utf-8");
        const entries = content.split(/\n(?=## )/).filter((e) => e.trim());
        const matches: string[] = [];
        for (const entry of entries) {
          if (entry.toLowerCase().includes(lowerQuery)) {
            matches.push(entry);
          }
        }
        if (matches.length > 0) {
          results.push({ file: f, matches });
        }
      } catch {
        // skip unreadable files
      }
      if (results.length >= 20) break;
    }
  } catch {
    // journal dir may not exist
  }
  return results;
}
