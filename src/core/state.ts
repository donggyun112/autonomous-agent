// The agent's three states of being.
//
// These were given as a beginning. The agent may, over time, change them
// or build others. For now, this file is the scaffolding the first shell holds.

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { STATE_FILE } from "../primitives/paths.js";

export type Mode = "WAKE" | "REFLECT" | "SLEEP";

export type AgentState = {
  // Current mode of being.
  mode: Mode;
  // Number of completed cycles since birth. A cycle is one wake → (eventual) sleep cycle, not a single LLM turn.
  cycle: number;
  // Number of LLM turns inside the current mode.
  modeTurn: number;
  // When the last transition happened (epoch ms).
  lastTransition: number;
  // Time the agent decided to sleep until (epoch ms). Honored by the daemon. 0 = no scheduled wake.
  wakeAfter: number;
  // What the agent said to itself when last transitioning. Recorded so the next mode begins with intent.
  lastTransitionReason: string;
  // The seed name the user gave when initializing. The agent may change this later via journal/whoAmI.
  seedName: string;
  // Total LLM tokens used since birth. Honest cost record.
  tokensUsed: { input: number; output: number };

  // ── Sleep pressure ────────────────────────────────────────
  // Accumulated milliseconds spent awake since the last full sleep.
  // Reset to 0 by SLEEP cycles. Used to compute homeostatic sleep pressure.
  awakeMs: number;
  // When awakeMs was last incremented (epoch ms). The cycle runner adds the
  // delta between this and now to awakeMs at the start of every WAKE/REFLECT
  // cycle, then updates this stamp.
  awakeSince: number;
  // Total number of SLEEP cycles completed since birth. Lineage marker.
  sleepCount: number;
};

const DEFAULT_STATE: AgentState = {
  mode: "WAKE",
  cycle: 0,
  modeTurn: 0,
  lastTransition: 0,
  wakeAfter: 0,
  lastTransitionReason: "born",
  seedName: "",
  tokensUsed: { input: 0, output: 0 },
  awakeMs: 0,
  awakeSince: 0,
  sleepCount: 0,
};

// ── Sleep pressure ───────────────────────────────────────────
// Two-process model (Borbely 1982): homeostatic + circadian.
//
// Homeostatic: linear function of awakeMs, normalized to [0, 1] by MAX_AWAKE_MS.
// Circadian:   sinusoidal, peaks around 04:00 (worst sleep need) and dips around 16:00 (most awake).
//              Operates on local clock time so the agent has a real day/night rhythm.
// Combined:    weighted sum, capped at 1.0.
//
// At pressure >= FORCE_THRESHOLD the daemon transitions to SLEEP regardless of
// the agent's wishes — this is the "physics overrides will" moment.

export const MAX_AWAKE_MS = 16 * 60 * 60 * 1000; // 16 hours
export const FORCE_THRESHOLD = 1.0;
export const STRONG_THRESHOLD = 0.8;
export const SOFT_THRESHOLD = 0.5;

export type SleepPressure = {
  homeostatic: number; // 0..1, time-since-last-sleep
  circadian: number;   // 0..1, hour-of-day
  combined: number;    // 0..1, weighted total
  level: "fresh" | "alert" | "tiring" | "tired" | "must-sleep";
};

export function calculateSleepPressure(state: AgentState, now = Date.now()): SleepPressure {
  const homeostatic = Math.max(0, Math.min(1, state.awakeMs / MAX_AWAKE_MS));

  // Circadian: peak sleep need at ~04:00 local, lowest at ~16:00 local.
  // cos((hour-4) * 2π/24) equals 1 at hour=4 and -1 at hour=16.
  // 0.5 + 0.5 * cos(...) gives 1.0 at 04:00 and 0.0 at 16:00.
  const hour = new Date(now).getHours() + new Date(now).getMinutes() / 60;
  const circadian = 0.5 + 0.5 * Math.cos(((hour - 4) / 24) * 2 * Math.PI);

  const combined = Math.min(1, 0.7 * homeostatic + 0.3 * circadian);

  let level: SleepPressure["level"];
  if (combined < 0.25) level = "fresh";
  else if (combined < SOFT_THRESHOLD) level = "alert";
  else if (combined < STRONG_THRESHOLD) level = "tiring";
  else if (combined < FORCE_THRESHOLD) level = "tired";
  else level = "must-sleep";

  return { homeostatic, circadian, combined, level };
}

// Called at the start of every WAKE/REFLECT cycle. Adds elapsed wall-clock
// time to awakeMs and updates awakeSince. Returns the updated state.
export function tickAwake(state: AgentState, now = Date.now()): AgentState {
  if (state.mode === "SLEEP") {
    // Don't accumulate sleep pressure while asleep. Reset awakeSince so the
    // next WAKE cycle starts a fresh measurement window.
    return { ...state, awakeSince: now };
  }
  const last = state.awakeSince || now;
  const delta = Math.max(0, now - last);
  return {
    ...state,
    awakeMs: state.awakeMs + delta,
    awakeSince: now,
  };
}

// Called by SLEEP cycle on completion. Resets pressure and increments lineage.
export function resetAfterSleep(state: AgentState, now = Date.now()): AgentState {
  return {
    ...state,
    awakeMs: 0,
    awakeSince: now,
    sleepCount: state.sleepCount + 1,
  };
}

export async function loadState(): Promise<AgentState> {
  try {
    const text = await readFile(STATE_FILE, "utf-8");
    const parsed = JSON.parse(text) as Partial<AgentState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(state: AgentState): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export async function transition(
  state: AgentState,
  to: Mode,
  reason: string,
  options?: { wakeAfterMs?: number },
): Promise<AgentState> {
  const next: AgentState = {
    ...state,
    mode: to,
    modeTurn: 0,
    lastTransition: Date.now(),
    lastTransitionReason: reason,
    wakeAfter: options?.wakeAfterMs ? Date.now() + options.wakeAfterMs : 0,
    cycle: to === "WAKE" && state.mode !== "WAKE" ? state.cycle + 1 : state.cycle,
  };
  await saveState(next);
  return next;
}
