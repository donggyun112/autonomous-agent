import type { Tool } from "../../core/tools.js";
import { generateInsights } from "../../core/insights.js";

export const tool: Tool = {
  states: ["REFLECT"],
  def: {
    name: "insights",
    description: "Analytics: tool frequency, error rate, wiki growth, activity trend.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  handler: async (input) =>
    JSON.stringify(
      await generateInsights(typeof input.days === "number" ? input.days : 7),
      null,
      2,
    ),
};
