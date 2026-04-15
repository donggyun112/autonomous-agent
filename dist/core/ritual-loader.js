// Ritual loader.
//
// Rituals are periodic practices the agent gives itself. They live as
// markdown files in src/extensions/rituals/ with frontmatter specifying
// when they fire. During SLEEP consolidation, the ritual runner checks
// if any rituals are due and executes them.
//
// Rituals are NOT tools — they are scheduled prompts injected during SLEEP
// or at the start of specific WAKE/REFLECT cycles. They're the agent's
// equivalent of "every Sunday I re-read my earliest journal entries."
//
// Expected format for src/extensions/rituals/<name>.md:
//
//   ---
//   name: weekly-return
//   description: Re-read earliest journal entries
//   schedule: every_n_sleeps
//   every: 7
//   mode: REFLECT
//   ---
//
//   Read your earliest journal entries (recall_recent_journal with days=30).
//   Ask: am I still the one who wrote these?
//   If something has shifted fundamentally, note it in your journal.
//
// Schedule types:
//   every_n_sleeps — fires every N sleep cycles (tracked via sleepCount)
//   every_n_cycles — fires every N total cycles
//   always         — fires every time the mode matches
import { appendFile, mkdir, readdir, readFile, stat } from "fs/promises";
import { dirname, join } from "path";
import { DATA, SRC } from "../primitives/paths.js";
import { readRecent } from "../memory/journal.js";
const RITUAL_LOG = join(DATA, "ritual-log.jsonl");
const RITUALS_DIR = join(SRC, "extensions", "rituals");
function parseSchedule(fields) {
    const type = fields.schedule;
    if (type === "always")
        return { type: "always" };
    if (type === "every_n_sleeps") {
        const every = parseInt(fields.every ?? "7", 10);
        return { type: "every_n_sleeps", every: Math.max(1, every) };
    }
    if (type === "every_n_cycles") {
        const every = parseInt(fields.every ?? "5", 10);
        return { type: "every_n_cycles", every: Math.max(1, every) };
    }
    return null;
}
function parseFrontmatter(text) {
    const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match)
        return { fields: {}, body: text };
    const fields = {};
    for (const line of match[1].split("\n")) {
        const kv = line.match(/^(\w+):\s*(.*)$/);
        if (kv)
            fields[kv[1]] = kv[2].replace(/^"|"$/g, "");
    }
    return { fields, body: match[2].trim() };
}
export async function listRituals() {
    const defs = [];
    let entries;
    try {
        entries = await readdir(RITUALS_DIR);
    }
    catch {
        return defs;
    }
    for (const name of entries) {
        if (!name.endsWith(".md"))
            continue;
        if (name.startsWith(".") || name === "README.md")
            continue;
        const full = join(RITUALS_DIR, name);
        try {
            const s = await stat(full);
            if (!s.isFile())
                continue;
            const text = await readFile(full, "utf-8");
            const { fields, body } = parseFrontmatter(text);
            if (!fields.name || !body)
                continue;
            const schedule = parseSchedule(fields);
            if (!schedule)
                continue;
            const mode = (fields.mode ?? "REFLECT").toUpperCase();
            const autoRecallDays = fields.auto_recall_days
                ? parseInt(fields.auto_recall_days, 10)
                : undefined;
            defs.push({
                name: fields.name,
                description: fields.description ?? "",
                schedule,
                mode,
                body,
                file: full,
                autoRecallDays: autoRecallDays && autoRecallDays > 0 ? autoRecallDays : undefined,
            });
        }
        catch {
            // skip broken files
        }
    }
    return defs;
}
// Check which rituals are due given the current state.
export function dueRituals(args) {
    return args.rituals.filter((r) => {
        if (r.mode !== args.currentMode)
            return false;
        switch (r.schedule.type) {
            case "always":
                return true;
            case "every_n_sleeps":
                return args.sleepCount > 0 && args.sleepCount % r.schedule.every === 0;
            case "every_n_cycles":
                return args.cycle > 0 && args.cycle % r.schedule.every === 0;
            default:
                return false;
        }
    });
}
// Log a ritual fire to data/ritual-log.jsonl for tracking accountability.
async function logRitualFire(ritual, cycle, sleepCount) {
    try {
        await mkdir(dirname(RITUAL_LOG), { recursive: true });
        const entry = JSON.stringify({
            ts: new Date().toISOString(),
            name: ritual.name,
            cycle,
            sleepCount,
            mode: ritual.mode,
            schedule: ritual.schedule,
        });
        await appendFile(RITUAL_LOG, entry + "\n", "utf-8");
    }
    catch {
        // logging failure should never crash the cycle
    }
}
// Build a prompt block from due rituals for injection into the system prompt.
// When a ritual has auto_recall_days, the journal content is fetched and
// injected alongside the instructions — giving rituals actual data to act on.
export async function buildRitualBlock(args) {
    const rituals = await listRituals();
    const due = dueRituals({ rituals, ...args });
    if (due.length === 0)
        return "";
    const blocks = [];
    for (const r of due) {
        // Log fire for accountability tracking.
        await logRitualFire(r, args.cycle, args.sleepCount);
        const parts = [
            `### ritual: ${r.name}`,
            r.description ? `_${r.description}_` : "",
            "",
            r.body,
        ];
        // Auto-recall: fetch journal entries and inject as context.
        if (r.autoRecallDays && r.autoRecallDays > 0) {
            try {
                const journal = await readRecent(r.autoRecallDays);
                if (journal) {
                    parts.push("", `#### auto-recalled journal (last ${r.autoRecallDays} days)`, "", journal.length > 3000 ? journal.slice(0, 3000) + "\n…(truncated)" : journal);
                }
            }
            catch {
                // journal read failure should not block ritual
            }
        }
        blocks.push(parts.filter(Boolean).join("\n"));
    }
    return [
        "---",
        "## rituals due this cycle",
        "",
        ...blocks,
    ].join("\n\n");
}
//# sourceMappingURL=ritual-loader.js.map