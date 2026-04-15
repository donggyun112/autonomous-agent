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
import { lintWiki } from "./wiki.js";
import { actionStats, readRecentActions } from "./action-log.js";
const CURIOSITY_FILE = join(DATA, "curiosity.md");
// ── 1. Random memory surfacing ───────────────────────────────────────────
export async function randomMemoryStimulus() {
    try {
        const recent = await recentMemories(50);
        if (recent.length < 3)
            return "";
        // Pick a random memory that ISN'T the most recent (avoid echo).
        const candidates = recent.slice(3);
        if (candidates.length === 0)
            return "";
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const mem = pick;
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
    }
    catch {
        return "";
    }
}
// ── 2. Curiosity question ────────────────────────────────────────────────
//
// The agent writes a curiosity question at the end of REFLECT.
// It's stored in data/curiosity.md and shown at the next WAKE.
export async function loadCuriosityQuestion() {
    try {
        const text = await readFile(CURIOSITY_FILE, "utf-8");
        if (!text.trim())
            return "";
        return [
            "---",
            "## a question you left for yourself",
            "",
            text.trim(),
            "",
            "This is the question you wrote at the end of your last reflection. You were curious about this. Are you still?",
        ].join("\n");
    }
    catch {
        return "";
    }
}
export async function saveCuriosityQuestion(question) {
    await mkdir(DATA, { recursive: true });
    await writeFile(CURIOSITY_FILE, question.trim() + "\n", "utf-8");
}
// ── 3. Stale wiki trigger ────────────────────────────────────────────────
export async function staleWikiStimulus() {
    try {
        const lint = await lintWiki({ staleDays: 14 });
        const stale = lint.findings.filter((f) => f.kind === "stale");
        if (stale.length === 0)
            return "";
        // Pick one random stale page.
        const pick = stale[Math.floor(Math.random() * stale.length)];
        return [
            "---",
            "## a page you haven't revisited",
            "",
            `Your wiki page \`${pick.slug}\` ${pick.detail}.`,
            "Has your understanding changed? Has it become irrelevant? Or have you been avoiding it?",
        ].join("\n");
    }
    catch {
        return "";
    }
}
// ── 4. Behavior blind spot ───────────────────────────────────────────────
const EXPECTED_TOOLS = [
    "journal", "recall_self", "recall_memory", "recall_recent_journal",
    "update_whoAmI", "check_continuity", "wiki_list", "wiki_read",
    "wiki_update", "wiki_lint", "web_search", "consult_oracle", "check_inbox",
    "write_letter", "review_actions", "manage_self", "read",
];
export async function behaviorBlindSpot(days = 7) {
    try {
        const stats = await actionStats(days);
        if (stats.totalCalls < 5)
            return ""; // too few actions to judge
        const used = new Set(Object.keys(stats.byTool));
        const unused = EXPECTED_TOOLS.filter((t) => !used.has(t));
        if (unused.length < 3)
            return ""; // using most tools — no blind spot
        return [
            "---",
            "## behavior blind spot",
            "",
            `In the last ${days} day(s), you have never used: ${unused.join(", ")}.`,
            "What are you not looking at? Is there something you are avoiding, or something you have not yet needed?",
        ].join("\n");
    }
    catch {
        return "";
    }
}
// ── 5. Tool usage stats ─────────────────────────────────────────────────
export async function toolUsageStats(days = 3) {
    try {
        const stats = await actionStats(days);
        if (stats.totalCalls < 3)
            return "";
        // Top 3 most used tools.
        const sorted = Object.entries(stats.byTool)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3);
        const errorRate = stats.totalCalls > 0
            ? ((stats.errors / stats.totalCalls) * 100).toFixed(1)
            : "0.0";
        return [
            "---",
            "## tool usage stats (last " + days + " day(s))",
            "",
            `**top tools:** ${sorted.map(([t, n]) => `${t} (${n})`).join(", ")}`,
            `**avg response time:** ${stats.avgDurationMs}ms`,
            `**error rate:** ${errorRate}% (${stats.errors}/${stats.totalCalls})`,
            "",
            "Are you relying too heavily on some tools? Are errors telling you something?",
        ].join("\n");
    }
    catch {
        return "";
    }
}
// ── 6. Repeated tool pattern check (skill auto-generation suggestion) ───
export async function repeatedToolPatternCheck(days = 7) {
    try {
        const entries = await readRecentActions(days);
        if (entries.length < 9)
            return ""; // need enough data for a 3-call pattern
        // Extract ordered tool names, grouped by cycle.
        const toolSequence = entries.map((e) => e.tool);
        // Find repeated sequences of 3+ tool calls in the same order.
        // Sliding window approach: extract all 3-grams, count occurrences.
        const patternCounts = new Map();
        for (let i = 0; i <= toolSequence.length - 3; i++) {
            const pattern = toolSequence.slice(i, i + 3).join(" -> ");
            patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
        }
        // Find patterns repeated 3+ times.
        const repeated = [...patternCounts.entries()]
            .filter(([, count]) => count >= 3)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3);
        if (repeated.length === 0)
            return "";
        const lines = [
            "---",
            "## repeated tool patterns detected",
            "",
        ];
        for (const [pattern, count] of repeated) {
            lines.push(`You've called [${pattern}] ${count} times. Consider creating a composite tool with manage_self.`);
        }
        lines.push("", "Repeating the same sequence might mean you need a higher-level tool that does this in one step.");
        return lines.join("\n");
    }
    catch {
        return "";
    }
}
// ── Combined: build all curiosity blocks for a cycle ─────────────────────
export async function buildCuriosityBlocks(mode) {
    const blocks = [];
    if (mode === "WAKE") {
        // Random memory — only in WAKE (fresh stimulus at the start of thinking).
        const mem = await randomMemoryStimulus();
        if (mem)
            blocks.push(mem);
        // Curiosity question from last REFLECT.
        const q = await loadCuriosityQuestion();
        if (q)
            blocks.push(q);
        // Stale wiki — occasionally (50% chance to avoid noise every cycle).
        if (Math.random() < 0.5) {
            const stale = await staleWikiStimulus();
            if (stale)
                blocks.push(stale);
        }
    }
    if (mode === "REFLECT") {
        // Behavior blind spot — only in REFLECT (introspection time).
        const blind = await behaviorBlindSpot(7);
        if (blind)
            blocks.push(blind);
        // Tool usage stats — give the agent data for self-analysis.
        const stats = await toolUsageStats(3);
        if (stats)
            blocks.push(stats);
        // Repeated tool pattern check — suggest composite tools.
        const patterns = await repeatedToolPatternCheck(7);
        if (patterns)
            blocks.push(patterns);
    }
    return blocks.join("\n\n");
}
//# sourceMappingURL=curiosity.js.map