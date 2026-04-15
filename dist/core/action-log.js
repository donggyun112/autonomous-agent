// Action log — records every tool call the agent makes.
//
// Hyperagents (Meta AI) found that the FIRST thing self-improving agents
// spontaneously create is logging infrastructure. Without a record of what
// was done, the agent cannot identify patterns, diagnose failures, or
// measure whether its modifications actually helped.
//
// journal/ records THOUGHTS. action-log records ACTIONS.
// Together they give the agent a complete picture of its own behavior.
//
// Format: JSONL append-only, one line per tool call. Daily files.
// The agent can read these via the read tool or a future analysis extension.
import { appendFile, mkdir, readFile, readdir } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";
const LOG_DIR = join(DATA, "action-log");
// Use agent-day (sleepCount) for file naming, not wall-clock date.
// Lazily cached to avoid loading state on every log call.
let _cachedDay = null;
async function todayFile() {
    if (_cachedDay === null) {
        try {
            const { loadState } = await import("./state.js");
            const state = await loadState();
            _cachedDay = state.sleepCount;
        }
        catch {
            _cachedDay = 0;
        }
    }
    return join(LOG_DIR, `day-${String(_cachedDay).padStart(3, "0")}.jsonl`);
}
// Reset cached day (called when sleep count changes).
export function resetActionLogDay() { _cachedDay = null; }
export async function logAction(entry) {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(await todayFile(), JSON.stringify(entry) + "\n", "utf-8");
}
// Read recent action logs — for the agent to introspect its own behavior.
export async function readRecentActions(days = 1) {
    let files;
    try {
        files = (await readdir(LOG_DIR))
            .filter((f) => f.endsWith(".jsonl"))
            .sort()
            .slice(-days);
    }
    catch {
        return [];
    }
    const entries = [];
    for (const f of files) {
        try {
            const text = await readFile(join(LOG_DIR, f), "utf-8");
            for (const line of text.split("\n")) {
                if (!line.trim())
                    continue;
                try {
                    entries.push(JSON.parse(line));
                }
                catch {
                    // skip malformed lines
                }
            }
        }
        catch {
            // skip unreadable files
        }
    }
    return entries;
}
// Summary stats — for status command and REFLECT introspection.
export async function actionStats(days = 1) {
    const entries = await readRecentActions(days);
    const byTool = {};
    let errors = 0;
    let totalDuration = 0;
    for (const e of entries) {
        byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
        if (e.error)
            errors += 1;
        totalDuration += e.duration_ms;
    }
    return {
        totalCalls: entries.length,
        byTool,
        errors,
        avgDurationMs: entries.length > 0 ? Math.round(totalDuration / entries.length) : 0,
    };
}
// Simple rate table: $/MTok.  Opus = $15/$75, Sonnet = $3/$15.
const COST_RATES = {
    opus: { input: 15, output: 75 },
    sonnet: { input: 3, output: 15 },
};
function estimateCost(entry) {
    // Default to Opus pricing (the primary model).
    const rate = COST_RATES.opus;
    return ((entry.inputTokens / 1_000_000) * rate.input +
        (entry.outputTokens / 1_000_000) * rate.output);
}
const COST_LOG = join(DATA, "cost-log.jsonl");
export async function logCycleCost(entry) {
    await mkdir(LOG_DIR, { recursive: true });
    const record = {
        ...entry,
        estimatedCostUsd: Number(estimateCost(entry).toFixed(4)),
    };
    await appendFile(COST_LOG, JSON.stringify(record) + "\n", "utf-8");
}
// ── Molt success rate ───────────────────────────────────────────────────
// From lineage.md parsing + generations/ scan. Hyperagents imp@k concept.
export async function moltStats() {
    const { LINEAGE, GENERATIONS } = await import("../primitives/paths.js");
    let successfulMolts = 0;
    try {
        const text = await readFile(LINEAGE, "utf-8");
        const moltLines = text.split("\n").filter((l) => l.startsWith("- **"));
        successfulMolts = moltLines.length;
    }
    catch {
        // lineage file may not exist
    }
    // Scan generations/ for directories that don't have a lineage entry.
    let totalGenerations = 0;
    try {
        const entries = await readdir(GENERATIONS, { withFileTypes: true });
        totalGenerations = entries.filter((e) => e.isDirectory()).length;
    }
    catch {
        // generations dir may not exist
    }
    const failedMolts = Math.max(0, totalGenerations - successfulMolts);
    const totalMolts = totalGenerations;
    const successRate = totalMolts > 0 ? successfulMolts / totalMolts : 1;
    return { totalMolts, failedMolts, successRate };
}
//# sourceMappingURL=action-log.js.map