import type { Tool } from "../../core/tools.js";
import { readRecentActions, actionStats } from "../../core/action-log.js";

export const tool: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "review_actions",
    description:
      "Review your action log — tool calls, timing, errors. Stats or raw entries.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "How many days of action logs to review. Default 1.",
        },
        stats_only: {
          type: "boolean",
          description: "If true, return summary stats (tool counts, error rate, avg duration) instead of raw entries. Good for a quick overview.",
        },
      },
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const days = typeof input.days === "number" ? input.days : 1;
    if (input.stats_only === true) {
      const stats = await actionStats(days);
      return JSON.stringify(stats, null, 2);
    }
    const entries = await readRecentActions(days);
    if (entries.length === 0) return "(no action logs yet)";
    // Return last 50 entries to avoid blowing context.
    const recent = entries.slice(-50);
    return JSON.stringify(recent, null, 2);
  },
};
