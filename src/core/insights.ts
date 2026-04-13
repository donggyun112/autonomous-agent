// Insights/analytics engine — surfaces usage patterns and trends.
import { readRecentActions, actionStats } from "./action-log.js";
import { readdir } from "fs/promises";
import { JOURNAL_DIR } from "../primitives/paths.js";

export type InsightReport = {
  totalCalls: number;
  errors: number;
  errorRate: number;
  avgDurationMs: number;
  topTools: Array<{ tool: string; count: number }>;
  journalDays: number;
  trend: "growing" | "stable" | "declining";
};

export async function generateInsights(days = 7): Promise<InsightReport> {
  const stats = await actionStats(days);
  const topTools = Object.entries(stats.byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }));

  let journalDays = 0;
  try {
    const files = await readdir(JOURNAL_DIR);
    journalDays = files.filter((f) => f.startsWith("day-") && f.endsWith(".md")).length;
  } catch { /* ok */ }

  const entries = await readRecentActions(days);
  let trend: "growing" | "stable" | "declining" = "stable";
  if (entries.length >= 10) {
    const half = Math.floor(entries.length / 2);
    const second = entries.slice(half).length;
    if (second > half * 1.2) trend = "growing";
    else if (second < half * 0.8) trend = "declining";
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
