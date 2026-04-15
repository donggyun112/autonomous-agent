// Insights/analytics engine — surfaces usage patterns and trends.
import { readRecentActions, actionStats } from "./action-log.js";
import { readdir } from "fs/promises";
import { JOURNAL_DIR } from "../primitives/paths.js";
export async function generateInsights(days = 7) {
    const stats = await actionStats(days);
    const topTools = Object.entries(stats.byTool)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tool, count]) => ({ tool, count }));
    let journalDays = 0;
    try {
        const files = await readdir(JOURNAL_DIR);
        journalDays = files.filter((f) => f.startsWith("day-") && f.endsWith(".md")).length;
    }
    catch { /* ok */ }
    // Trend: compare tool call activity in first half vs second half of the period.
    // Use actual timestamps to split, not array indices — entries within a day
    // are naturally ordered, so we split by midpoint timestamp.
    const entries = await readRecentActions(days);
    let trend = "stable";
    if (entries.length >= 10) {
        const midTs = entries[Math.floor(entries.length / 2)].ts;
        const firstHalfCalls = entries.filter(e => e.ts < midTs).length;
        const secondHalfCalls = entries.filter(e => e.ts >= midTs).length;
        if (secondHalfCalls > firstHalfCalls * 1.3)
            trend = "growing";
        else if (secondHalfCalls < firstHalfCalls * 0.7)
            trend = "declining";
    }
    return {
        totalCalls: stats.totalCalls,
        errors: stats.errors,
        errorRate: stats.totalCalls > 0 ? Math.round((stats.errors / stats.totalCalls) * 1000) / 1000 : 0,
        avgDurationMs: stats.avgDurationMs,
        topTools,
        journalDays,
        trend,
    };
}
//# sourceMappingURL=insights.js.map