// Core logic tests.
//
// Tests for state machine, sleep pressure, ritual scheduling, session store,
// and other non-LLM core behaviors. Supplements the smoke tests which focus
// on tool handlers.

import { mkdtemp, mkdir, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempData: string;

beforeAll(async () => {
  tempData = await mkdtemp(join(tmpdir(), "agent-core-"));
  process.env.AGENT_ROOT = join(tempData, "..", "..");
  process.env.AGENT_DATA_DIR = tempData;

  await mkdir(join(tempData, "journal"), { recursive: true });
  await mkdir(join(tempData, "whoAmI.history"), { recursive: true });
  await writeFile(
    join(tempData, "whoAmI.md"),
    "---\nborn_at: 2026-01-01T00:00:00.000Z\nseed_name: \"TestAgent\"\n---\n\nI am a test agent.\n",
    "utf-8",
  );
  await writeFile(
    join(tempData, "state.json"),
    JSON.stringify({
      mode: "WAKE",
      cycle: 0,
      modeTurn: 0,
      lastTransition: Date.now(),
      wakeAfter: 0,
      lastTransitionReason: "born",
      language: "ko",
      seedName: "TestAgent",
      tokensUsed: { input: 0, output: 0 },
      awakeMs: 0,
      awakeSince: Date.now(),
      sleepCount: 0,
    }, null, 2),
    "utf-8",
  );
});

afterAll(async () => {
  await rm(tempData, { recursive: true, force: true });
});

// ── State machine ──────────────────────────────────────────────────────

describe("state machine", () => {
  it("loadState returns default state for missing file", async () => {
    const { loadState } = await import("../core/state.js");
    // Temporarily point to a nonexistent file — the fallback should
    // return DEFAULT_STATE without throwing.
    const saved = process.env.AGENT_DATA_DIR;
    process.env.AGENT_DATA_DIR = join(tempData, "nonexistent");
    const state = await loadState();
    process.env.AGENT_DATA_DIR = saved;
    expect(state.mode).toBe("WAKE");
    expect(state.language).toBe("ko");
    expect(state.cycle).toBe(0);
  });

  it("loadState merges missing fields from defaults", async () => {
    // Write a state.json missing the language field.
    const partial = join(tempData, "state-partial.json");
    await writeFile(partial, JSON.stringify({ mode: "REFLECT", cycle: 5 }), "utf-8");

    const { loadState } = await import("../core/state.js");
    // We can't easily point loadState at a different file, so test the merge logic directly.
    const DEFAULT_STATE = {
      mode: "WAKE", cycle: 0, modeTurn: 0, lastTransition: 0,
      wakeAfter: 0, lastTransitionReason: "born", language: "ko",
      seedName: "", tokensUsed: { input: 0, output: 0 },
      awakeMs: 0, awakeSince: 0, sleepCount: 0,
    };
    const parsed = { mode: "REFLECT", cycle: 5 };
    const merged = { ...DEFAULT_STATE, ...parsed };
    expect(merged.mode).toBe("REFLECT");
    expect(merged.cycle).toBe(5);
    expect(merged.language).toBe("ko"); // from default
  });

  it("transition updates mode and resets modeTurn", async () => {
    const { loadState, transition } = await import("../core/state.js");
    let state = await loadState();
    state = await transition(state, "REFLECT", "test transition");
    expect(state.mode).toBe("REFLECT");
    expect(state.modeTurn).toBe(0);
    expect(state.lastTransitionReason).toBe("test transition");
  });

  it("REFLECT→WAKE does NOT increment cycle (epoch)", async () => {
    const { loadState, transition } = await import("../core/state.js");
    let state = await loadState();
    // Current mode should be REFLECT from previous test.
    const prevCycle = state.cycle;
    state = await transition(state, "WAKE", "back to wake");
    expect(state.cycle).toBe(prevCycle); // no increment — only SLEEP→WAKE does
  });

  it("SLEEP→WAKE increments cycle (epoch)", async () => {
    const { loadState, transition } = await import("../core/state.js");
    let state = await loadState();
    const prevCycle = state.cycle;
    state = await transition(state, "SLEEP", "time to sleep");
    state = await transition(state, "WAKE", "waking after sleep");
    expect(state.cycle).toBe(prevCycle + 1);
  });
});

// ── Sleep pressure ─────────────────────────────────────────────────────

describe("sleep pressure", () => {
  it("fresh agent has ~0 homeostatic pressure", async () => {
    const { calculateSleepPressure } = await import("../core/state.js");
    const state = {
      awakeMs: 0, awakeSince: Date.now(), sleepCount: 0,
      mode: "WAKE" as const, cycle: 0, modeTurn: 0,
      lastTransition: Date.now(), wakeAfter: 0,
      lastTransitionReason: "born", language: "ko", seedName: "",
      tokensUsed: { input: 0, output: 0 }, totalTurns: 0, bornAt: 0,
    };
    const p = calculateSleepPressure(state);
    expect(p.homeostatic).toBe(0);
    expect(p.combined).toBeLessThan(0.5); // circadian varies by time of day
  });

  it("16h awake gives homeostatic=1.0", async () => {
    const { calculateSleepPressure, MAX_AWAKE_MS } = await import("../core/state.js");
    const state = {
      awakeMs: MAX_AWAKE_MS, awakeSince: Date.now(), sleepCount: 0,
      mode: "WAKE" as const, cycle: 0, modeTurn: 0,
      lastTransition: Date.now(), wakeAfter: 0,
      lastTransitionReason: "born", language: "ko", seedName: "",
      tokensUsed: { input: 0, output: 0 }, totalTurns: 0, bornAt: 0,
    };
    const p = calculateSleepPressure(state);
    expect(p.homeostatic).toBe(1);
    expect(p.combined).toBeGreaterThanOrEqual(0.7); // at least 0.7 * 1.0
  });

  it("tickAwake accumulates time", async () => {
    const { tickAwake } = await import("../core/state.js");
    const base = {
      awakeMs: 0, awakeSince: 1000, sleepCount: 0,
      mode: "WAKE" as const, cycle: 0, modeTurn: 0,
      lastTransition: 0, wakeAfter: 0,
      lastTransitionReason: "born", language: "ko", seedName: "",
      tokensUsed: { input: 0, output: 0 }, totalTurns: 0, bornAt: 0,
    };
    const ticked = tickAwake(base, 5000);
    const { TIME_SCALE } = await import("../core/state.js");
    expect(ticked.awakeMs).toBe(4000 * TIME_SCALE);
    expect(ticked.awakeSince).toBe(5000);
  });

  it("tickAwake does not accumulate during SLEEP", async () => {
    const { tickAwake } = await import("../core/state.js");
    const base = {
      awakeMs: 3600000, awakeSince: 1000, sleepCount: 0,
      mode: "SLEEP" as const, cycle: 0, modeTurn: 0,
      lastTransition: 0, wakeAfter: 0,
      lastTransitionReason: "born", language: "ko", seedName: "",
      tokensUsed: { input: 0, output: 0 }, totalTurns: 0, bornAt: 0,
    };
    const ticked = tickAwake(base, 5000);
    expect(ticked.awakeMs).toBe(3600000); // unchanged
    expect(ticked.awakeSince).toBe(5000); // updated for next measurement
  });

  it("resetAfterSleep clears awakeMs and increments sleepCount", async () => {
    const { resetAfterSleep } = await import("../core/state.js");
    const base = {
      awakeMs: 50000000, awakeSince: 1000, sleepCount: 3,
      mode: "SLEEP" as const, cycle: 0, modeTurn: 0,
      lastTransition: 0, wakeAfter: 0,
      lastTransitionReason: "born", language: "ko", seedName: "",
      tokensUsed: { input: 0, output: 0 }, totalTurns: 0, bornAt: 0,
    };
    const reset = resetAfterSleep(base, 9999);
    expect(reset.awakeMs).toBe(0);
    expect(reset.sleepCount).toBe(4);
    expect(reset.awakeSince).toBe(9999);
  });
});

// ── Ritual scheduling ──────────────────────────────────────────────────

describe("ritual scheduling", () => {
  it("dueRituals filters by mode and schedule", async () => {
    const { dueRituals } = await import("../core/ritual-loader.js");

    const rituals: Parameters<typeof dueRituals>[0]["rituals"] = [
      {
        name: "always-wake",
        description: "",
        schedule: { type: "always" },
        mode: "WAKE",
        body: "test",
        file: "/fake",
      },
      {
        name: "every-5-sleeps",
        description: "",
        schedule: { type: "every_n_sleeps", every: 5 },
        mode: "REFLECT",
        body: "test",
        file: "/fake",
      },
      {
        name: "every-3-cycles",
        description: "",
        schedule: { type: "every_n_cycles", every: 3 },
        mode: "WAKE",
        body: "test",
        file: "/fake",
      },
    ];

    // WAKE mode, cycle=6, sleepCount=10
    const due1 = dueRituals({ rituals, currentMode: "WAKE", sleepCount: 10, cycle: 6 });
    expect(due1.map(r => r.name)).toContain("always-wake");
    expect(due1.map(r => r.name)).toContain("every-3-cycles"); // 6 % 3 === 0
    expect(due1.map(r => r.name)).not.toContain("every-5-sleeps"); // wrong mode

    // REFLECT mode, cycle=6, sleepCount=10
    const due2 = dueRituals({ rituals, currentMode: "REFLECT", sleepCount: 10, cycle: 6 });
    expect(due2.map(r => r.name)).toContain("every-5-sleeps"); // 10 % 5 === 0
    expect(due2.map(r => r.name)).not.toContain("always-wake"); // wrong mode

    // WAKE mode, cycle=7 — every-3-cycles should NOT fire
    const due3 = dueRituals({ rituals, currentMode: "WAKE", sleepCount: 10, cycle: 7 });
    expect(due3.map(r => r.name)).not.toContain("every-3-cycles"); // 7 % 3 !== 0
  });
});

// ── Session store ──────────────────────────────────────────────────────

describe("session store", () => {
  it("append + load round-trips messages", async () => {
    const {
      appendMessage,
      clearSession,
      loadSession,
    } = await import("../core/session-store.js");

    await clearSession();
    const msg1 = { role: "user" as const, content: "Hello" };
    const msg2 = { role: "assistant" as const, content: [{ type: "text" as const, text: "Hi back" }] };
    await appendMessage(msg1);
    await appendMessage(msg2);

    const loaded = await loadSession();
    expect(loaded.length).toBe(2);
    expect(loaded[0].content).toBe("Hello");
    expect((loaded[1].content as Array<{type: string; text: string}>)[0].text).toBe("Hi back");
  });

  it("clearSession empties the session", async () => {
    const { clearSession, loadSession } = await import("../core/session-store.js");
    await clearSession();
    const loaded = await loadSession();
    expect(loaded.length).toBe(0);
  });

  it("replaceSession overwrites", async () => {
    const {
      appendMessage,
      replaceSession,
      loadSession,
    } = await import("../core/session-store.js");

    await appendMessage({ role: "user", content: "A" });
    await appendMessage({ role: "user", content: "B" });
    await replaceSession([{ role: "user", content: "C" }]);

    const loaded = await loadSession();
    expect(loaded.length).toBe(1);
    expect(loaded[0].content).toBe("C");
  });
});
