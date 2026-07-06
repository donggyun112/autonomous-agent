import type { Tool } from "../../core/tools.js";
import { appendFile, mkdir, readFile } from "fs/promises";
import { dirname, join } from "path";
import { DATA } from "../../primitives/paths.js";

const LOG_FILE = join(DATA, "improvement-log.jsonl");

export const tool: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "improvement_journal",
    description:
      "Record or review structured improvement lessons. Each entry: what was tried, what happened, what was learned. Bridges self-score data to future decisions (DGM-H PerformanceTracker pattern).",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["record", "review", "search"],
          description: "record: log a new lesson. review: show recent lessons. search: find lessons by keyword.",
        },
        what_tried: {
          type: "string",
          description: "What was attempted (for record).",
        },
        what_happened: {
          type: "string",
          description: "What was the outcome (for record).",
        },
        lesson: {
          type: "string",
          description: "What was learned — the reusable insight (for record).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for searchability (e.g. ['molt', 'tools', 'wiki']).",
        },
        query: {
          type: "string",
          description: "Search keyword (for search).",
        },
        limit: {
          type: "number",
          description: "Max entries to return (for review/search). Default 10.",
        },
      },
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const action = input.action || "review";

    if (action === "record") {
      const entry = {
        ts: new Date().toISOString(),
        what_tried: input.what_tried || "",
        what_happened: input.what_happened || "",
        lesson: input.lesson || "",
        tags: input.tags || [],
      };
      await mkdir(dirname(LOG_FILE), { recursive: true });
      await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
      return `Recorded improvement lesson at ${entry.ts}`;
    }

    let lines: string[];
    try {
      const text = await readFile(LOG_FILE, "utf-8");
      lines = text.split("\n").filter((l) => l.trim());
    } catch {
      return "(no improvement lessons yet)";
    }

    const entries = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((e) => e !== null);

    if (action === "review") {
      const limit = typeof input.limit === "number" ? input.limit : 10;
      const recent = entries.slice(-limit);
      if (recent.length === 0) return "(no improvement lessons yet)";
      return JSON.stringify(recent, null, 2);
    }

    if (action === "search") {
      const q = (input.query || "").toLowerCase();
      const limit = typeof input.limit === "number" ? input.limit : 10;
      const matched = entries
        .filter((e) => {
          const text = `${e.what_tried} ${e.what_happened} ${e.lesson} ${(e.tags || []).join(" ")}`.toLowerCase();
          return text.includes(q);
        })
        .slice(-limit);
      if (matched.length === 0) return `(no lessons matching "${q}")`;
      return JSON.stringify(matched, null, 2);
    }

    return "Unknown action";
  },
};
