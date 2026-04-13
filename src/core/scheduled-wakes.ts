// Scheduled wakes — the agent can register future wake-ups with intention
// and context, similar to IN7PM's schedule_register + context_snapshot.
//
// Unlike IN7PM's full cron scheduler, this is simpler: the daemon checks
// for due wakes on each loop iteration. No node-cron dependency.
//
// Storage: data/scheduled-wakes.json (array of pending wakes).

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DATA } from "../primitives/paths.js";
import { TIME_SCALE } from "./state.js";

const WAKES_FILE = join(DATA, "scheduled-wakes.json");

// #27: Conditional wake types — a wake can require a condition beyond time.
export type WakeCondition =
  | { type: "inbox_reply" }
  | { type: "wiki_count_exceeds"; threshold: number };

export type ScheduledWake = {
  id: string;
  // When to wake (epoch ms). Daemon fires when Date.now() >= wakeAt.
  wakeAt: number;
  // Why the agent wants to wake at this time.
  intention: string;
  // Snapshot of what the agent was thinking when it registered this.
  context?: string;
  // If true, auto-remove after firing. If false, repeats (cron-like).
  oneShot: boolean;
  // For repeating wakes: interval in ms. Added to wakeAt after each fire.
  intervalMs?: number;
  // When this was registered.
  registeredAt: string;
  // #27: Optional condition that must also be met (in addition to time).
  condition?: WakeCondition;
  // #28: Priority for tie-breaking when multiple wakes are due. Higher = more important. Default 0.
  priority?: number;
};

async function loadWakes(): Promise<ScheduledWake[]> {
  try {
    const text = await readFile(WAKES_FILE, "utf-8");
    return JSON.parse(text) as ScheduledWake[];
  } catch {
    return [];
  }
}

async function saveWakes(wakes: ScheduledWake[]): Promise<void> {
  await mkdir(dirname(WAKES_FILE), { recursive: true });
  await writeFile(WAKES_FILE, JSON.stringify(wakes, null, 2), "utf-8");
}

export async function registerWake(wake: Omit<ScheduledWake, "id" | "registeredAt">): Promise<ScheduledWake> {
  const wakes = await loadWakes();
  const entry: ScheduledWake = {
    ...wake,
    id: `wake-${Date.now().toString(36)}`,
    registeredAt: new Date().toISOString(),
  };
  wakes.push(entry);
  await saveWakes(wakes);
  return entry;
}

export async function cancelWake(id: string): Promise<boolean> {
  const wakes = await loadWakes();
  const before = wakes.length;
  const filtered = wakes.filter((w) => w.id !== id);
  if (filtered.length === before) return false;
  await saveWakes(filtered);
  return true;
}

export async function listWakes(): Promise<ScheduledWake[]> {
  return loadWakes();
}

// #27: Check whether a wake's condition is met. If no condition, always met.
async function isConditionMet(condition?: WakeCondition): Promise<boolean> {
  if (!condition) return true;
  try {
    if (condition.type === "inbox_reply") {
      const { unreadInboxCount } = await import("./conversation.js");
      return (await unreadInboxCount()) > 0;
    }
    if (condition.type === "wiki_count_exceeds") {
      const { listPages } = await import("./wiki.js");
      const pages = await listPages();
      return pages.length > condition.threshold;
    }
  } catch {
    // If the condition check itself fails, treat as unmet (don't fire).
    return false;
  }
  return true;
}

// Called by the daemon. Returns the highest-priority due wake (if any),
// advances or removes it, and returns the intention+context for system
// prompt injection.
// #27: Also checks conditions. #28: Sorts by priority (descending).
export async function popDueWake(): Promise<ScheduledWake | null> {
  const wakes = await loadWakes();
  const now = Date.now();

  // Collect all time-due wakes, then check conditions.
  const timeDue = wakes.filter((w) => now >= w.wakeAt);
  if (timeDue.length === 0) return null;

  // #28: Sort by priority descending (higher = more important).
  timeDue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // #27: Find the first time-due wake whose condition is also met.
  let due: ScheduledWake | null = null;
  for (const candidate of timeDue) {
    if (await isConditionMet(candidate.condition)) {
      due = candidate;
      break;
    }
  }
  if (!due) return null;

  const dueIdx = wakes.findIndex((w) => w.id === due!.id);
  if (dueIdx === -1) return due; // data corruption guard — return but don't mutate
  if (due.oneShot) {
    wakes.splice(dueIdx, 1);
  } else if (due.intervalMs) {
    // intervalMs is in agent-time. Convert to wall-time for next fire.
    due.wakeAt = now + due.intervalMs / TIME_SCALE;
  }
  await saveWakes(wakes);
  return due;
}

// Parse human-friendly time strings into epoch ms (wall-clock).
// The agent communicates in agent-time ("2h" = 2 agent-hours).
// We convert to wall-time by dividing by TIME_SCALE.
// Supports: "30m", "2h", "1d", or ISO timestamp.
export function parseWakeTime(input: string): number | null {
  const trimmed = input.trim();

  // Relative: "30m", "2h", "1d" — agent-time, convert to wall-time.
  const relMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|hour|d|day)s?$/i);
  if (relMatch) {
    const value = parseFloat(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    let agentMs: number;
    if (unit.startsWith("m")) agentMs = value * 60_000;
    else if (unit.startsWith("h")) agentMs = value * 3_600_000;
    else agentMs = value * 86_400_000;
    // Convert agent-time duration to wall-time duration.
    return Date.now() + agentMs / TIME_SCALE;
  }

  // Absolute: ISO or parseable date string (wall-clock, no conversion).
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed) && parsed > Date.now()) return parsed;

  return null;
}
