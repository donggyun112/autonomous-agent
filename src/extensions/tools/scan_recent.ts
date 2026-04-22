import type { Tool } from "../../core/tools.js";
import { shallowMemories } from "../../primitives/recall.js";

export const tool: Tool = {
  def: {
    name: "scan_recent",
    description: "List recent memories that have not yet been dreamed deeply. Useful to see what you have been thinking about.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const limit = Number(input.limit ?? 20);
    const list = await shallowMemories(0.5, limit);
    return JSON.stringify(list, null, 2);
  },
};
