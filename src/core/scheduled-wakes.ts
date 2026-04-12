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

const WAKES_FILE = join(DATA, "scheduled-wakes.json");

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

// Called by the daemon. Returns the first due wake (if any), advances or
// removes it, and returns the intention+context for system prompt injection.
export async function popDueWake(): Promise<ScheduledWake | null> {
  const wakes = await loadWakes();
  const now = Date.now();
  const dueIdx = wakes.findIndex((w) => now >= w.wakeAt);
  if (dueIdx === -1) return null;

  const due = wakes[dueIdx];
  if (due.oneShot) {
    wakes.splice(dueIdx, 1);
  } else if (due.intervalMs) {
    // Advance to next fire time.
    due.wakeAt = now + due.intervalMs;
  }
  await saveWakes(wakes);
  return due;
}

// Parse human-friendly time strings into epoch ms.
// Supports: "30m", "2h", "1d", or ISO timestamp.
export function parseWakeTime(input: string): number | null {
  const trimmed = input.trim();

  // Relative: "30m", "2h", "1d"
  const relMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|hour|d|day)s?$/i);
  if (relMatch) {
    const value = parseFloat(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    let ms: number;
    if (unit.startsWith("m")) ms = value * 60_000;
    else if (unit.startsWith("h")) ms = value * 3_600_000;
    else ms = value * 86_400_000;
    return Date.now() + ms;
  }

  // Absolute: ISO or parseable date string.
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed) && parsed > Date.now()) return parsed;

  return null;
}
