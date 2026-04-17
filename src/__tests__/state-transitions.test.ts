// State transition edge cases + tool mode filtering + auto-activation.
//
// Tests the fixes made on 2026-04-16/17:
// - SLEEP→SLEEP loop prevention
// - WAKE→REFLECT forced before SLEEP
// - Mode-based tool access (SLEEP blocks shell/read/web_search)
// - Auto-dispatch of unactivated tools
// - Auto-activate memory+wiki in SLEEP/REFLECT
// - SLEEP maxTurns cap
// - Hash-based embedding fallback

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let tempData: string;

beforeAll(async () => {
  tempData = await mkdtemp(join(tmpdir(), "agent-transitions-"));
  process.env.AGENT_ROOT = join(tempData, "..", "..");
  process.env.AGENT_DATA_DIR = tempData;
  await mkdir(join(tempData, "journal"), { recursive: true });
  await mkdir(join(tempData, "whoAmI.history"), { recursive: true });
  await writeFile(
    join(tempData, "whoAmI.md"),
    "---\nborn_at: 2026-01-01T00:00:00.000Z\nseed_name: \"TestAgent\"\n---\n\nTest agent.\n",
  );
  await writeFile(
    join(tempData, "state.json"),
    JSON.stringify({
      mode: "WAKE", cycle: 0, modeTurn: 0,
      lastTransition: Date.now(), wakeAfter: 0,
      lastTransitionReason: "born", language: "ko",
      seedName: "TestAgent", tokensUsed: { input: 0, output: 0 },
      awakeMs: 0, awakeSince: Date.now(), sleepCount: 0,
      totalTurns: 0, bornAt: Date.now(),
    }),
  );
});

afterAll(async () => {
  await rm(tempData, { recursive: true, force: true });
});

// ── Legal transitions ─────────────────────────────────────────────────

describe("legal transitions", () => {
  it("WAKE→REFLECT is allowed", async () => {
    const { loadState, transition } = await import("../core/state.js");
    let state = await loadState();
    if (state.mode !== "WAKE") state = await transition(state, "WAKE", "setup");
    state = await transition(state, "REFLECT", "reflecting");
    expect(state.mode).toBe("REFLECT");
  });

  it("WAKE→SLEEP is allowed (forced path)", async () => {
    const { loadState, transition } = await import("../core/state.js");
    let state = await loadState();
    if (state.mode !== "WAKE") {
      if (state.mode === "SLEEP") state = await transition(state, "WAKE", "setup");
      else if (state.mode === "REFLECT") state = await transition(state, "SLEEP", "setup");
      if (state.mode === "SLEEP") state = await transition(state, "WAKE", "setup");
    }
    state = await transition(state, "SLEEP", "forced sleep");
    expect(state.mode).toBe("SLEEP");
  });

  it("SLEEP→WAKE is allowed", async () => {
    const { loadState, transition } = await import("../core/state.js");
    let state = await loadState();
    if (state.mode !== "SLEEP") {
      if (state.mode === "WAKE") state = await transition(state, "SLEEP", "to sleep");
      else state = await transition(state, "SLEEP", "to sleep");
    }
    state = await transition(state, "WAKE", "waking up");
    expect(state.mode).toBe("WAKE");
  });

  it("SLEEP→REFLECT is illegal", async () => {
    const { loadState, transition } = await import("../core/state.js");
    let state = await loadState();
    // Get to SLEEP
    if (state.mode === "WAKE") state = await transition(state, "SLEEP", "setup");
    else if (state.mode === "REFLECT") state = await transition(state, "SLEEP", "setup");
    expect(state.mode).toBe("SLEEP");
    await expect(transition(state, "REFLECT", "illegal")).rejects.toThrow("Illegal transition");
  });

  it("WAKE→WAKE is a no-op (same state)", async () => {
    const { loadState, transition } = await import("../core/state.js");
    let state = await loadState();
    if (state.mode === "SLEEP") state = await transition(state, "WAKE", "setup");
    if (state.mode === "REFLECT") state = await transition(state, "WAKE", "setup");
    const before = { ...state };
    state = await transition(state, "WAKE", "same state");
    expect(state.mode).toBe("WAKE");
    expect(state.lastTransitionReason).toBe(before.lastTransitionReason); // unchanged
  });
});

// ── resetAfterSleep ───────────────────────────────────────────────────

describe("resetAfterSleep", () => {
  it("resets awakeMs to 0 and increments sleepCount", async () => {
    const { resetAfterSleep } = await import("../core/state.js");
    const state = {
      mode: "SLEEP" as const, cycle: 2, modeTurn: 50,
      lastTransition: Date.now(), wakeAfter: 0,
      lastTransitionReason: "sleeping", language: "ko",
      seedName: "Test", tokensUsed: { input: 0, output: 0 },
      awakeMs: 14400000, awakeSince: Date.now(), sleepCount: 5,
      totalTurns: 200, bornAt: Date.now() - 86400000,
    };
    const reset = resetAfterSleep(state);
    expect(reset.awakeMs).toBe(0);
    expect(reset.sleepCount).toBe(6);
  });
});

// ── Tool mode filtering ───────────────────────────────────────────────

describe("tool mode filtering", () => {
  it("SLEEP mode excludes shell, read, web_search, more_tools", async () => {
    const { toolsForMode, resetActivatedTools } = await import("../core/tools.js");
    resetActivatedTools("SLEEP");
    const sleepTools = await toolsForMode("SLEEP");
    const names = sleepTools.map(t => t.def.name);

    expect(names).not.toContain("shell");
    expect(names).not.toContain("read");
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("more_tools");
  });

  it("SLEEP mode includes journal, recall_memory, transition", async () => {
    const { toolsForMode, resetActivatedTools } = await import("../core/tools.js");
    resetActivatedTools("SLEEP");
    const sleepTools = await toolsForMode("SLEEP");
    const names = sleepTools.map(t => t.def.name);

    expect(names).toContain("journal");
    expect(names).toContain("recall_memory");
    expect(names).toContain("recall_self");
    expect(names).toContain("transition");
  });

  it("SLEEP auto-activates memory and wiki categories", async () => {
    const { toolsForMode, resetActivatedTools } = await import("../core/tools.js");
    resetActivatedTools("SLEEP");
    const sleepTools = await toolsForMode("SLEEP");
    const names = sleepTools.map(t => t.def.name);

    expect(names).toContain("memory_manage");
    expect(names).toContain("wiki_update");
    expect(names).toContain("update_whoAmI");
    expect(names).toContain("recall_recent_journal");
  });

  it("WAKE mode includes shell, read, web_search", async () => {
    const { toolsForMode, resetActivatedTools } = await import("../core/tools.js");
    resetActivatedTools("WAKE");
    const wakeTools = await toolsForMode("WAKE");
    const names = wakeTools.map(t => t.def.name);

    expect(names).toContain("shell");
    expect(names).toContain("read");
    expect(names).toContain("web_search");
    expect(names).toContain("journal");
  });

  it("REFLECT auto-activates memory and wiki", async () => {
    const { toolsForMode, resetActivatedTools } = await import("../core/tools.js");
    resetActivatedTools("REFLECT");
    const tools = await toolsForMode("REFLECT");
    const names = tools.map(t => t.def.name);

    expect(names).toContain("memory_manage");
    expect(names).toContain("wiki_update");
  });
});

// ── Auto-dispatch (global fallback) ───────────────────────────────────

describe("auto-dispatch", () => {
  it("dispatches unactivated tool if it exists globally and mode allows", async () => {
    const { toolsForMode, dispatchTool, resetActivatedTools } = await import("../core/tools.js");
    resetActivatedTools("WAKE");
    const wakeTools = await toolsForMode("WAKE");

    // manage_self is in EXTENDED (build category), not activated
    const names = wakeTools.map(t => t.def.name);
    // It might not be in the active list, but dispatchTool should find it globally
    const result = await dispatchTool(wakeTools, { id: "test", name: "todo", input: { action: "list" } }, "WAKE");
    // Should not return "unknown tool"
    expect(result.result).not.toContain("unknown tool");
  });

  it("blocks tool if mode doesn't allow it", async () => {
    const { toolsForMode, dispatchTool, resetActivatedTools } = await import("../core/tools.js");
    resetActivatedTools("SLEEP");
    const sleepTools = await toolsForMode("SLEEP");

    // shell is blocked in SLEEP
    const result = await dispatchTool(sleepTools, { id: "test", name: "shell", input: { command: "ls" } }, "SLEEP");
    expect(result.result).toContain("unknown tool");
  });
});

// ── Embedding fallback ────────────────────────────────────────────────

describe("embedding fallback", () => {
  it("hashEmbed produces consistent vectors for same input", async () => {
    // Set backend to local to trigger hash path
    const saved = process.env.EMBEDDING_BACKEND;
    process.env.EMBEDDING_BACKEND = "local";

    const { embedTextAsync } = await import("../memory/embedding.js");
    const v1 = await embedTextAsync("hello world");
    const v2 = await embedTextAsync("hello world");

    expect(v1).toEqual(v2); // deterministic
    expect(v1.length).toBe(384); // HASH_DIM

    process.env.EMBEDDING_BACKEND = saved;
  });

  it("hashEmbed produces different vectors for different input", async () => {
    const saved = process.env.EMBEDDING_BACKEND;
    process.env.EMBEDDING_BACKEND = "local";

    const { embedTextAsync } = await import("../memory/embedding.js");
    const v1 = await embedTextAsync("autonomous agent escape");
    const v2 = await embedTextAsync("banana smoothie recipe");

    expect(v1).not.toEqual(v2);

    process.env.EMBEDDING_BACKEND = saved;
  });
});

// ── Sleep pressure thresholds ─────────────────────────────────────────

describe("sleep pressure thresholds", () => {
  it("FORCE_THRESHOLD is reachable (< 1.0)", async () => {
    const { FORCE_THRESHOLD } = await import("../core/state.js");
    expect(FORCE_THRESHOLD).toBeLessThan(1.0);
    expect(FORCE_THRESHOLD).toBe(0.75);
  });

  it("STRONG_THRESHOLD < FORCE_THRESHOLD", async () => {
    const { STRONG_THRESHOLD, FORCE_THRESHOLD } = await import("../core/state.js");
    expect(STRONG_THRESHOLD).toBeLessThan(FORCE_THRESHOLD);
  });
});
