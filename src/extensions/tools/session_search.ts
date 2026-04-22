import type { Tool } from "../../core/tools.js";
import { searchSessions } from "../../core/session-store.js";

export const tool: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "session_search",
    description:
      "Search across your archived past sessions. Each time you sleep, your session is archived. Use this to search for something you remember thinking or discussing in a previous session. Returns matching archive files with a short preview of the match.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text to search for in past sessions.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const query = String(input.query ?? "").trim();
    if (!query) return "[error] query is required";
    const results = await searchSessions(query);
    if (results.length === 0) {
      return `(no archived sessions contain "${query}")`;
    }
    return results
      .map((r) => `- ${r.file}: ${r.preview}`)
      .join("\n");
  },
};
