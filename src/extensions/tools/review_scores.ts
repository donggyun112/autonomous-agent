import type { Tool } from "../../core/tools.js";
import { getScoreTrend } from "../../core/self-score.js";

export const tool: Tool = {
  states: ["REFLECT"],
  def: {
    name: "review_scores",
    description: "Review self-improvement scores across cycles. Shows trend.",
    input_schema: {
      type: "object",
      properties: {
        last_n: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  handler: async (input) =>
    JSON.stringify(
      await getScoreTrend(typeof input.last_n === "number" ? input.last_n : 10),
      null,
      2,
    ),
};
