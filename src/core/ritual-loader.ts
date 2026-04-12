// Ritual loader.
//
// Rituals are periodic practices the agent gives itself. They live as
// markdown files in src/extensions/rituals/ with frontmatter specifying
// when they fire. During SLEEP consolidation, the ritual runner checks
// if any rituals are due and executes them.
//
// Rituals are NOT tools — they are scheduled prompts injected during SLEEP
// or at the start of specific WAKE/REFLECT cycles. They're the agent's
// equivalent of "every Sunday I re-read my earliest journal entries."
//
// Expected format for src/extensions/rituals/<name>.md:
//
//   ---
//   name: weekly-return
//   description: Re-read earliest journal entries
//   schedule: every_n_sleeps
//   every: 7
//   mode: REFLECT
//   ---
//
//   Read your earliest journal entries (recall_recent_journal with days=30).
//   Ask: am I still the one who wrote these?
//   If something has shifted fundamentally, note it in your journal.
//
// Schedule types:
//   every_n_sleeps — fires every N sleep cycles (tracked via sleepCount)
//   every_n_cycles — fires every N total cycles
//   always         — fires every time the mode matches

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { SRC } from "../primitives/paths.js";

const RITUALS_DIR = join(SRC, "extensions", "rituals");

export type RitualSchedule =
  | { type: "every_n_sleeps"; every: number }
  | { type: "every_n_cycles"; every: number }
  | { type: "always" };

export type RitualDef = {
  name: string;
  description: string;
  schedule: RitualSchedule;
  mode: "WAKE" | "REFLECT" | "SLEEP";
  body: string;  // the instruction text, injected as a prompt section
  file: string;
};

function parseSchedule(fields: Record<string, string>): RitualSchedule | null {
  const type = fields.schedule;
  if (type === "always") return { type: "always" };
  if (type === "every_n_sleeps") {
    const every = parseInt(fields.every ?? "7", 10);
    return { type: "every_n_sleeps", every: Math.max(1, every) };
  }
  if (type === "every_n_cycles") {
    const every = parseInt(fields.every ?? "5", 10);
    return { type: "every_n_cycles", every: Math.max(1, every) };
  }
  return null;
}

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

export async function listRituals(): Promise<RitualDef[]> {
  const defs: RitualDef[] = [];
  let entries: string[];
  try {
    entries = await readdir(RITUALS_DIR);
  } catch {
    return defs;
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    if (name.startsWith(".") || name === "README.md") continue;
    const full = join(RITUALS_DIR, name);
    try {
      const s = await stat(full);
      if (!s.isFile()) continue;
      const text = await readFile(full, "utf-8");
      const { fields, body } = parseFrontmatter(text);
      if (!fields.name || !body) continue;
      const schedule = parseSchedule(fields);
      if (!schedule) continue;
      const mode = (fields.mode ?? "REFLECT").toUpperCase() as RitualDef["mode"];
      defs.push({
        name: fields.name,
        description: fields.description ?? "",
        schedule,
        mode,
        body,
        file: full,
      });
    } catch {
      // skip broken files
    }
  }
  return defs;
}

// Check which rituals are due given the current state.
export function dueRituals(args: {
  rituals: RitualDef[];
  currentMode: string;
  sleepCount: number;
  cycle: number;
}): RitualDef[] {
  return args.rituals.filter((r) => {
    if (r.mode !== args.currentMode) return false;
    switch (r.schedule.type) {
      case "always":
        return true;
      case "every_n_sleeps":
        return args.sleepCount > 0 && args.sleepCount % r.schedule.every === 0;
      case "every_n_cycles":
        return args.cycle > 0 && args.cycle % r.schedule.every === 0;
      default:
        return false;
    }
  });
}

// Build a prompt block from due rituals for injection into the system prompt.
export async function buildRitualBlock(args: {
  currentMode: string;
  sleepCount: number;
  cycle: number;
}): Promise<string> {
  const rituals = await listRituals();
  const due = dueRituals({ rituals, ...args });
  if (due.length === 0) return "";

  const blocks = due.map((r) => [
    `### ritual: ${r.name}`,
    r.description ? `_${r.description}_` : "",
    "",
    r.body,
  ].filter(Boolean).join("\n"));

  return [
    "---",
    "## rituals due this cycle",
    "",
    ...blocks,
  ].join("\n\n");
}
