// Autonomous skill creation — detects repeated tool patterns and suggests composite tools.
import { readRecentActions } from "./action-log.js";
export async function detectAndSuggestSkill(days = 3) {
    const entries = await readRecentActions(days);
    if (entries.length < 20)
        return null;
    const trigrams = new Map();
    for (let i = 0; i < entries.length - 2; i++) {
        const key = `${entries[i].tool}→${entries[i + 1].tool}→${entries[i + 2].tool}`;
        trigrams.set(key, (trigrams.get(key) ?? 0) + 1);
    }
    const repeated = [...trigrams.entries()]
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1]);
    if (repeated.length === 0)
        return null;
    const [pattern, count] = repeated[0];
    const [t1, t2, t3] = pattern.split("→");
    return [
        "---",
        "## skill suggestion",
        "",
        `You've used the sequence [${t1} → ${t2} → ${t3}] ${count} times in the last ${days} days.`,
        "Consider creating a composite tool with manage_self.",
    ].join("\n");
}
//# sourceMappingURL=skill-engine.js.map