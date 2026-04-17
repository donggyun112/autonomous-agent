// Tool stability tests.
//
// Ensures memory_manage (delete, compress), transition guards, and sleep
// consolidation gates work correctly. No LLM calls, no network.

import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempData: string;
let toolsMod: typeof import("../core/tools.js");

beforeAll(async () => {
  tempData = await mkdtemp(join(tmpdir(), "agent-stability-"));
  process.env.AGENT_ROOT = join(tempData, "..", "..");
  process.env.AGENT_DATA_DIR = tempData;

  await mkdir(join(tempData, "journal"), { recursive: true });
  await mkdir(join(tempData, "whoAmI.history"), { recursive: true });
  await mkdir(join(tempData, "memory"), { recursive: true });
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
      seedName: "TestAgent",
      language: "ko",
      tokensUsed: { input: 0, output: 0 },
      awakeMs: 0,
      awakeSince: Date.now(),
      sleepCount: 0,
      totalTurns: 0,
      bornAt: Date.now(),
    }, null, 2),
    "utf-8",
  );

  toolsMod = await import("../core/tools.js");
});

afterAll(async () => {
  await rm(tempData, { recursive: true, force: true });
});

async function findTool(name: string) {
  for (const mode of ["WAKE", "REFLECT", "SLEEP"] as const) {
    const tools = await toolsMod.toolsForMode(mode);
    const hit = tools.find((t) => t.def.name === name);
    if (hit) return hit;
  }
  const { registry } = await import("../core/tool-registry.js");
  const regTool = registry.get(name);
  if (regTool) return regTool;
  throw new Error(`tool not found: ${name}`);
}

// ── memory_manage: add ──────────────────────────────────────────────────

describe("memory_manage add", () => {
  it("adds a memory with keys", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({
      action: "add",
      content: "cycle.ts is the main life-loop file",
      keys: ["cycle", "core", "life-loop"],
    });
    expect(out).toContain("added memory");
    expect(out).toContain("cycle");
  });

  it("adds a second memory for delete test", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({
      action: "add",
      content: "this memory should be deleted later",
      keys: ["deleteme", "temporary"],
    });
    expect(out).toContain("added memory");
  });
});

// ── memory_manage: list ─────────────────────────────────────────────────

describe("memory_manage list", () => {
  it("lists memories with IDs", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({ action: "list" });
    expect(out).toContain("memory:");
    // Should have at least 2 memories from the add tests
    const parsed = JSON.parse(out.split("\n").slice(1).join("\n"));
    expect(parsed.length).toBeGreaterThanOrEqual(2);
  });
});

// ── memory_manage: delete ───────────────────────────────────────────────

describe("memory_manage delete", () => {
  it("deletes a memory by ID", async () => {
    const tool = await findTool("memory_manage");

    // First list to get IDs
    const listOut = await tool.handler({ action: "list" });
    const listJson = JSON.parse(listOut.split("\n").slice(1).join("\n"));
    const toDelete = listJson.find((m: { content: string }) =>
      m.content.includes("should be deleted"),
    );
    expect(toDelete).toBeTruthy();

    // Delete it
    const delOut = await tool.handler({
      action: "delete",
      memory_id: toDelete.id,
    });
    expect(delOut).toContain("deleted");
    expect(delOut).not.toContain("error");
    expect(delOut).not.toContain("not found");
  });

  it("returns error for non-existent memory ID", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({
      action: "delete",
      memory_id: "nonexistent123",
    });
    expect(out).toContain("not found");
  });

  it("requires memory_id for delete", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({ action: "delete" });
    // Without memory_id, falls through to unknown action
    expect(out).toContain("unknown action");
  });
});

// ── memory_manage: compress ─────────────────────────────────────────────

describe("memory_manage compress", () => {
  it("returns error when memory_id is missing", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({
      action: "compress",
      compressed: "shorter version",
    });
    expect(out).toContain("error");
    expect(out).toContain("requires both memory_id and compressed");
  });

  it("returns error when compressed text is missing", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({
      action: "compress",
      memory_id: "some-id",
    });
    expect(out).toContain("error");
    expect(out).toContain("requires both memory_id and compressed");
  });

  it("compresses a memory with both fields", async () => {
    const tool = await findTool("memory_manage");

    // Get an existing memory ID
    const listOut = await tool.handler({ action: "list" });
    const listJson = JSON.parse(listOut.split("\n").slice(1).join("\n"));
    expect(listJson.length).toBeGreaterThan(0);
    const targetId = listJson[0].id;

    const out = await tool.handler({
      action: "compress",
      memory_id: targetId,
      compressed: "cycle.ts = main loop (compressed)",
    });
    expect(out).toContain("compressed");
    expect(out).toContain(targetId);
  });
});

// ── memory_manage: rekey ────────────────────────────────────────────────

describe("memory_manage rekey", () => {
  it("rekeys a memory with new keys", async () => {
    const tool = await findTool("memory_manage");

    const listOut = await tool.handler({ action: "list" });
    const listJson = JSON.parse(listOut.split("\n").slice(1).join("\n"));
    expect(listJson.length).toBeGreaterThan(0);
    const targetId = listJson[0].id;

    const out = await tool.handler({
      action: "rekey",
      memory_id: targetId,
      new_keys: ["new-key-1", "new-key-2"],
    });
    expect(out).toContain("rekeyed");
  });

  it("returns error for non-existent memory", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({
      action: "rekey",
      memory_id: "nonexistent999",
      new_keys: ["key"],
    });
    expect(out).toContain("not found");
  });
});

// ── memory_manage: link ─────────────────────────────────────────────────

describe("memory_manage link", () => {
  it("links two memories", async () => {
    const tool = await findTool("memory_manage");

    // Add a second memory to link with
    await tool.handler({
      action: "add",
      content: "state.ts manages sleep pressure",
      keys: ["state", "sleep-pressure"],
    });

    const listOut = await tool.handler({ action: "list" });
    const listJson = JSON.parse(listOut.split("\n").slice(1).join("\n"));
    expect(listJson.length).toBeGreaterThanOrEqual(2);

    const out = await tool.handler({
      action: "link",
      memory_id: listJson[0].id,
      target_id: listJson[1].id,
      via: "core-architecture",
    });
    expect(out).toContain("linked");
  });
});

// ── memory_manage: unknown action ───────────────────────────────────────

describe("memory_manage unknown action", () => {
  it("returns helpful error for unknown action", async () => {
    const tool = await findTool("memory_manage");
    const out = await tool.handler({ action: "explode" });
    expect(out).toContain("unknown action");
    expect(out).toContain("add, list, compress, delete, rekey, link");
  });
});
