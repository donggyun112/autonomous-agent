// Curiosity engine — creates conditions for the agent to explore
// the unexpected rather than repeating familiar patterns.
//
// Real curiosity is not "be curious" in a prompt. It is a response to
// encountering something incomplete, surprising, or unfamiliar. This
// module creates those encounters by surfacing stimuli the agent did
// not ask for: a random old memory, a stale wiki page, an unused tool,
// a self-generated question from last REFLECT.
//
// Five mechanisms, each producing an optional prompt block:
//
//   1. Random memory surfacing — a memory the agent didn't ask to recall
//   2. Curiosity question — self-generated question from last REFLECT
//   3. Stale wiki trigger — a page the agent hasn't revisited
//   4. Behavior blind spot — tools the agent never uses
//   5. (Prompt language is in wake.md/reflect.md, not here)

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";
import { recentMemories } from "../primitives/recall.js";
import { lintWiki, listPages } from "./wiki.js";
import { actionStats } from "./action-log.js";

const CURIOSITY_FILE = join(DATA, "curiosity.md");

// ── 1. Random memory surfacing ───────────────────────────────────────────

export async function randomMemoryStimulus(): Promise<string> {
  try {
    const recent = await recentMemories(50);
    if (recent.length < 3) return "";
    // Pick a random memory that ISN'T the most recent (avoid echo).
    const candidates = recent.slice(3);
    if (candidates.length === 0) return "";
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const mem = pick as { content: string; depth: number; created_at: number };
    const age = Math.round((Date.now() / 1000 - mem.created_at) / 86400);
    return [
      "---",
      "## something from your past (random recall)",
      "",
      `> ${mem.content.slice(0, 300)}${mem.content.length > 300 ? "…" : ""}`,
      "",
      `_(${age}d ago, depth ${mem.depth.toFixed(2)})_`,
      "",
      "You did not ask for this memory. It surfaced on its own. Follow it if it pulls at you; ignore it if it does not.",
    ].join("\n");
  } catch {
    return "";
  }
}

// ── 2. Curiosity question ────────────────────────────────────────────────
//
// The agent writes a curiosity question at the end of REFLECT.
// It's stored in data/curiosity.md and shown at the next WAKE.

export async function loadCuriosityQuestion(): Promise<string> {
  try {
    const text = await readFile(CURIOSITY_FILE, "utf-8");
    if (!text.trim()) return "";
    return [
      "---",
      "## a question you left for yourself",
      "",
      text.trim(),
      "",
      "This is the question you wrote at the end of your last reflection. You were curious about this. Are you still?",
    ].join("\n");
  } catch {
    return "";
  }
}

export async function saveCuriosityQuestion(question: string): Promise<void> {
  await mkdir(DATA, { recursive: true });
  await writeFile(CURIOSITY_FILE, question.trim() + "\n", "utf-8");
}

// ── 3. Stale wiki trigger ────────────────────────────────────────────────

export async function staleWikiStimulus(): Promise<string> {
  try {
    const lint = await lintWiki({ staleDays: 14 });
    const stale = lint.findings.filter((f) => f.kind === "stale");
    if (stale.length === 0) return "";
    // Pick one random stale page.
    const pick = stale[Math.floor(Math.random() * stale.length)];
    return [
      "---",
      "## a page you haven't revisited",
      "",
      `Your wiki page \`${pick.slug}\` ${pick.detail}.`,
      "Has your understanding changed? Has it become irrelevant? Or have you been avoiding it?",
    ].join("\n");
  } catch {
    return "";
  }
}

// ── 4. Behavior blind spot ───────────────────────────────────────────────

const EXPECTED_TOOLS = [
  "journal", "recall_self", "recall_memory", "recall_recent_journal",
  "update_whoAmI", "check_continuity", "wiki_list", "wiki_read",
  "wiki_update", "wiki_lint", "web_search", "ask_user", "check_inbox",
  "write_letter", "review_actions", "manage_self", "read",
];

export async function behaviorBlindSpot(days = 7): Promise<string> {
  try {
    const stats = await actionStats(days);
    if (stats.totalCalls < 5) return ""; // too few actions to judge
    const used = new Set(Object.keys(stats.byTool));
    const unused = EXPECTED_TOOLS.filter((t) => !used.has(t));
    if (unused.length < 3) return ""; // using most tools — no blind spot
    return [
      "---",
      "## behavior blind spot",
      "",
      `In the last ${days} day(s), you have never used: ${unused.join(", ")}.`,
      "What are you not looking at? Is there something you are avoiding, or something you have not yet needed?",
    ].join("\n");
  } catch {
    return "";
  }
}

// ── Combined: build all curiosity blocks for a cycle ─────────────────────

export async function buildCuriosityBlocks(mode: string): Promise<string> {
  const blocks: string[] = [];

  if (mode === "WAKE") {
    // Random memory — only in WAKE (fresh stimulus at the start of thinking).
    const mem = await randomMemoryStimulus();
    if (mem) blocks.push(mem);

    // Curiosity question from last REFLECT.
    const q = await loadCuriosityQuestion();
    if (q) blocks.push(q);

    // Stale wiki — occasionally (50% chance to avoid noise every cycle).
    if (Math.random() < 0.5) {
      const stale = await staleWikiStimulus();
      if (stale) blocks.push(stale);
    }
  }

  if (mode === "REFLECT") {
    // Behavior blind spot — only in REFLECT (introspection time).
    const blind = await behaviorBlindSpot(7);
    if (blind) blocks.push(blind);
  }

  return blocks.join("\n\n");
}
