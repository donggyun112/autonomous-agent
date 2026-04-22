import type { Tool } from "../../core/tools.js";
import { searchJournal } from "../../memory/journal.js";
import { searchSessionsRanked } from "../../core/session-store.js";

export const tool: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "deep_search",
    description: "Search across both journal AND session archives. Unified results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const q = String(input.query ?? "").trim();
    if (!q) return "[error] query required";
    const [jr, sr] = await Promise.all([searchJournal(q), searchSessionsRanked(q, 10)]);
    const p: string[] = [];
    if (jr.length > 0) {
      p.push("## Journal");
      for (const r of jr) {
        p.push(`### ${r.file}`);
        p.push(...r.matches);
      }
    }
    if (sr.length > 0) {
      p.push("## Sessions");
      for (const r of sr) p.push(`- [${r.file}] (${r.score}) ${r.preview}`);
    }
    return p.length > 0 ? p.join("\n") : `(no results for "${q}")`;
  },
};
