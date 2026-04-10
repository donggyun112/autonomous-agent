// Tool smoke tests.
//
// Each test calls a tool handler once against a fresh temp body and checks
// that basic success path works. No LLM calls, no network.
//
// Skipped because of external deps:
//   - dream (needs LLM)
//   - check_continuity (needs embedding API)
//   - web_search (needs BRAVE_API_KEY)
//   - molt_stage / molt_test / molt_swap (needs docker)
//
// The skipped tools are covered by their own integration tests (molt
// self-test already does end-to-end verification).

import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempData: string;
let toolsMod: typeof import("../core/tools.js");

beforeAll(async () => {
  tempData = await mkdtemp(join(tmpdir(), "agent-smoke-"));
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
    JSON.stringify(
      {
        mode: "WAKE",
        cycle: 0,
        modeTurn: 0,
        lastTransition: Date.now(),
        wakeAfter: 0,
        lastTransitionReason: "born",
        seedName: "TestAgent",
        tokensUsed: { input: 0, output: 0 },
        awakeMs: 0,
        awakeSince: Date.now(),
        sleepCount: 0,
      },
      null,
      2,
    ),
    "utf-8",
  );

  toolsMod = await import("../core/tools.js");
});

afterAll(async () => {
  await rm(tempData, { recursive: true, force: true });
});

function findTool(name: string) {
  for (const mode of ["WAKE", "REFLECT", "SLEEP"] as const) {
    const tools = toolsMod.toolsForMode(mode);
    const hit = tools.find((t) => t.def.name === name);
    if (hit) return hit;
  }
  throw new Error(`tool not found: ${name}`);
}

// ── identity ─────────────────────────────────────────────────────────────

describe("identity tools", () => {
  it("recall_self returns whoAmI", async () => {
    const tool = findTool("recall_self");
    const out = await tool.handler({});
    expect(out).toContain("TestAgent");
    expect(out).toContain("I am a test agent");
  });

  it("update_whoAmI snapshots and writes new content", async () => {
    const tool = findTool("update_whoAmI");
    const out = await tool.handler({
      new_text: "I am a test agent, and I have been revised.",
      reason: "smoke-test revision",
    });
    expect(out).toContain("whoAmI updated");
    const snaps = await readdir(join(tempData, "whoAmI.history"));
    expect(snaps.length).toBeGreaterThan(0);
  });
});

// ── journal ──────────────────────────────────────────────────────────────

describe("journal tool", () => {
  it("writes a thought to the daily file", async () => {
    const tool = findTool("journal");
    const out = await tool.handler({ text: "a smoke test thought" });
    expect(out).toContain("journaled");
    const files = await readdir(join(tempData, "journal"));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\d{4}-\d{2}-\d{2}\.md/);
  });

  it("accepts explicit keys", async () => {
    const tool = findTool("journal");
    const out = await tool.handler({
      text: "another smoke thought with keys",
      keys: ["smoke", "test", "keys"],
    });
    expect(out).toContain("smoke");
  });
});

// ── recall ───────────────────────────────────────────────────────────────

describe("recall tools", () => {
  it("recall_recent_journal returns content", async () => {
    const tool = findTool("recall_recent_journal");
    const out = await tool.handler({ days: 1 });
    expect(out).toContain("smoke test thought");
  });

  it("scan_recent returns something", async () => {
    const tool = findTool("scan_recent");
    const out = await tool.handler({ limit: 10 });
    expect(typeof out).toBe("string");
  });
});

// ── wiki ─────────────────────────────────────────────────────────────────

describe("wiki tools", () => {
  it("wiki_list on empty wiki shows empty message or empty list", async () => {
    const tool = findTool("wiki_list");
    const out = await tool.handler({});
    expect(typeof out).toBe("string");
  });

  it("wiki_update creates a page", async () => {
    const tool = findTool("wiki_update");
    const out = await tool.handler({
      slug: "solitude",
      kind: "concept",
      title: "Solitude",
      body: "A concept page for smoke testing.",
      reason: "smoke test",
    });
    expect(out).toContain("created");
    expect(out).toContain("solitude");
  });

  it("wiki_read returns the just-created page", async () => {
    const tool = findTool("wiki_read");
    const out = await tool.handler({ slug: "solitude", kind: "concept" });
    expect(out).toContain("Solitude");
    expect(out).toContain("smoke testing");
  });

  it("wiki_update revises on second call", async () => {
    const tool = findTool("wiki_update");
    const out = await tool.handler({
      slug: "solitude",
      kind: "concept",
      title: "Solitude",
      body: "A concept page for smoke testing, now revised.",
      reason: "smoke test revision",
    });
    expect(out).toContain("updated");
  });

  it("wiki_lint reports on the wiki state", async () => {
    const tool = findTool("wiki_lint");
    const out = await tool.handler({});
    const report = JSON.parse(out);
    expect(report.totalPages).toBeGreaterThan(0);
    expect(Array.isArray(report.findings)).toBe(true);
    const orphans = report.findings.filter((f: { kind: string }) => f.kind === "orphan");
    expect(orphans.length).toBeGreaterThan(0);
  });
});

// ── conversation ─────────────────────────────────────────────────────────

describe("conversation tools", () => {
  let questionId: string;

  it("ask_user writes to outbox", async () => {
    const tool = findTool("ask_user");
    const out = await tool.handler({
      question: "Do you know what you mean by memory?",
      reason: "The word keeps surfacing and I am not sure I mean the same thing each time.",
    });
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("pending");
    expect(parsed.id).toBeTruthy();
    questionId = parsed.id;
  });

  it("check_inbox returns empty when nothing from user yet", async () => {
    const tool = findTool("check_inbox");
    const out = await tool.handler({});
    expect(out).toContain("empty");
  });

  it("check_inbox sees a user reply", async () => {
    const { userReply } = await import("../core/conversation.js");
    await userReply({ inReplyTo: questionId, text: "I think you mean several things at once." });

    const tool = findTool("check_inbox");
    const out = await tool.handler({});
    expect(out).toContain("several things at once");
  });

  it("write_letter creates a letter file", async () => {
    const tool = findTool("write_letter");
    const out = await tool.handler({
      text: "A letter that may never be read, but is written anyway.",
      title: "first letter",
    });
    const parsed = JSON.parse(out);
    expect(parsed.id).toBeTruthy();
    expect(parsed.file).toContain("letter");
  });
});

// ── manage_self ──────────────────────────────────────────────────────────

describe("manage_self tool", () => {
  it("list_scopes returns allowed scopes", async () => {
    const tool = findTool("manage_self");
    const out = await tool.handler({ kind: "list_scopes" });
    expect(out).toContain("subagent");
    expect(out).toContain("ritual");
    expect(out).toContain("state-prompt");
  });

  it("list returns empty for an empty scope", async () => {
    const tool = findTool("manage_self");
    const out = await tool.handler({ kind: "list", scope: "ritual" });
    expect(out).toMatch(/no ritual/);
  });
});

// ── control sentinels ────────────────────────────────────────────────────

describe("control tools", () => {
  it("transition handler returns the sentinel string", async () => {
    const tool = findTool("transition");
    const out = await tool.handler({ to: "REFLECT", reason: "smoke" });
    expect(out).toContain("TRANSITION_REQUESTED");
  });

  it("rest handler returns the sentinel string", async () => {
    const tool = findTool("rest");
    const out = await tool.handler({});
    expect(out).toContain("REST_REQUESTED");
  });
});
