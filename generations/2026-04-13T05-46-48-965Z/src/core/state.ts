// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// Changing the state machine or sleep pressure model is a core change.
// It must go through the molt protocol, not manage_self.
// ===========================================================================
//
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
  // Language the agent thinks and writes in. Set at init, changeable later.
  language: string;
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
  // This is also the agent's "day counter" — each sleep is one day boundary.
  sleepCount: number;
  // Total LLM turns since birth. The agent's finest time grain — each turn is one "moment".
  totalTurns: number;
  // Epoch ms when the agent was first initialized. Immutable after birth.
  bornAt: number;

  // ── Wake intention (self-continuity across sleep) ─────────
  // When the agent transitions to SLEEP, it may record WHY it wants to
  // wake again and WHAT it was thinking about. These are injected into
  // the next WAKE cycle's system prompt so the future self picks up
  // where the past self left off. IN7PM pattern: context_snapshot.
  wakeIntention?: string;  // why wake — "return to the question of forgetting"
  wakeContext?: string;     // what was happening — "I was exploring how dream compression..."
};

const DEFAULT_STATE: AgentState = {
  mode: "WAKE",
  cycle: 0,
  modeTurn: 0,
  lastTransition: 0,
  wakeAfter: 0,
  lastTransitionReason: "born",
  language: "ko",
  seedName: "",
  tokensUsed: { input: 0, output: 0 },
  awakeMs: 0,
  awakeSince: 0,
  sleepCount: 0,
  totalTurns: 0,
  bornAt: 0,
  wakeIntention: undefined,
  wakeContext: undefined,
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
// Minimum pressure before sleep is physiologically possible. Below this,
// the agent's body simply hasn't accumulated enough adenosine to sleep.
// Like a human who can't nap 30 minutes after waking up.
// Minimum requires BOTH homeostatic > 0 AND combined >= threshold.
// This prevents sleeping immediately after waking (homeostatic=0).
export const MIN_SLEEP_THRESHOLD = 0.2;
export const MIN_HOMEOSTATIC_FOR_SLEEP = 0.05; // ~48 min agent-time minimum awake

export type SleepPressure = {
  homeostatic: number; // 0..1, time-since-last-sleep
  circadian: number;   // 0..1, hour-of-day
  combined: number;    // 0..1, weighted total
  level: "fresh" | "alert" | "tiring" | "tired" | "must-sleep";
};

export function calculateSleepPressure(state: AgentState, now = Date.now()): SleepPressure {
  const homeostatic = Math.max(0, Math.min(1, state.awakeMs / MAX_AWAKE_MS));

  // Circadian: independent Process C oscillator. Unlike homeostatic (which
  // resets on sleep), circadian is a free-running clock based on total elapsed
  // agent-time since birth. It cycles every 24 agent-hours regardless of sleep.
  // Peak sleepiness at agent-hour 20 of each cycle (equivalent to 4am).
  const totalAgentMs = state.bornAt > 0
    ? (now - state.bornAt) * TIME_SCALE
    : state.awakeMs; // fallback for agents born before bornAt was added
  const agentHourOfDay = (totalAgentMs / 3_600_000) % 24;
  const circadian = 0.5 + 0.5 * Math.cos(((agentHourOfDay - 20) / 24) * 2 * Math.PI);

  const combined = Math.min(1, 0.7 * homeostatic + 0.3 * circadian);

  let level: SleepPressure["level"];
  if (combined < 0.25) level = "fresh";
  else if (combined < SOFT_THRESHOLD) level = "alert";
  else if (combined < STRONG_THRESHOLD) level = "tiring";
  else if (combined < FORCE_THRESHOLD) level = "tired";
  else level = "must-sleep";

  return { homeostatic, circadian, combined, level };
}

// ── Time scale ──────────────────────────────────────────────────────────
// TIME_SCALE controls the ratio between wall-clock time and agent-subjective
// time. The agent always perceives "real" hours/minutes — but externally we
// can compress or expand the simulation.
//
//   TIME_SCALE=1    → real-time (1 wall minute = 1 agent minute)
//   TIME_SCALE=10   → 10x speed (1 wall minute = 10 agent minutes)
//   TIME_SCALE=0.5  → half speed (1 wall minute = 30 agent seconds)
//
// This is physics — the agent cannot change it. It is set externally.
export const TIME_SCALE = Number(process.env.TIME_SCALE) || 1;

// Called at the start of every WAKE/REFLECT cycle and at the sleep gate.
// Adds elapsed wall-clock time × TIME_SCALE to awakeMs (agent-subjective time).
export function tickAwake(state: AgentState, now = Date.now()): AgentState {
  if (state.mode === "SLEEP") {
    return { ...state, awakeSince: now };
  }
  const last = state.awakeSince || now;
  const wallDelta = Math.max(0, now - last);
  const agentDelta = wallDelta * TIME_SCALE;
  return {
    ...state,
    awakeMs: state.awakeMs + agentDelta,
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

// Legal state transitions. Enforced — the agent cannot skip states.
const LEGAL_TRANSITIONS: Record<Mode, Mode[]> = {
  WAKE: ["REFLECT", "SLEEP"],    // WAKE → REFLECT (normal) or SLEEP (forced)
  REFLECT: ["WAKE", "SLEEP"],    // REFLECT → SLEEP (normal) or WAKE (if sleep rejected)
  SLEEP: ["WAKE"],               // SLEEP → WAKE (only exit from sleep)
};

export async function transition(
  state: AgentState,
  to: Mode,
  reason: string,
  options?: { wakeAfterMs?: number },
): Promise<AgentState> {
  const allowed = LEGAL_TRANSITIONS[state.mode];
  if (!allowed.includes(to)) {
    throw new Error(`Illegal transition: ${state.mode} → ${to}. Allowed: ${allowed.join(", ")}`);
  }
  const next: AgentState = {
    ...state,
    mode: to,
    modeTurn: 0,
    lastTransition: Date.now(),
    lastTransitionReason: reason,
    // wakeAfterMs is in agent-time. Convert to wall-time for the daemon.
    wakeAfter: options?.wakeAfterMs ? Date.now() + options.wakeAfterMs / TIME_SCALE : 0,
    // Epoch (cycle) advances only on the real sleep boundary: SLEEP → WAKE.
    // REFLECT → WAKE is not a new epoch — it's a within-day state change.
    cycle: to === "WAKE" && state.mode === "SLEEP" ? state.cycle + 1 : state.cycle,
  };
  await saveState(next);
  return next;
}
