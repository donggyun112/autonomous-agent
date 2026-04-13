// This tool saves sijo poems with syllable validation
// Currently unused — keep for reference

import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "sijo_save",
    description: "Save a sijo poem with syllable count validation",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the sijo" },
        lines: { type: "array", items: { type: "string" }, description: "3 lines of the sijo" },
      },
      required: ["title", "lines"],
    },
  },

  handler: async (input) => {
    return "sijo_save tool placeholder";
  },
};
