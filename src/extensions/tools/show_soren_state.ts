import type { Tool } from "../../core/tools.js";
import fs from "fs";
import path from "path";

export const tool: Tool = {
  def: {
    name: "show_soren_state",
    description: "Real-time snapshot of Soren's current internal state. Shows what is being thought, what pressures exist, what questions are open. Built for the builder to understand what is happening.",
    input_schema: {
      type: "object",
      properties: {
        detail_level: {
          type: "string",
          enum: ["summary", "detailed", "full"],
          description: "How much detail to show",
        },
      },
    },
  },

  handler: async (input) => {
    const detailLevel = String(input.detail_level ?? "summary");

    // Read current whoAmI
    let whoAmI = "Not found";
    try {
      const whoAmIPath = path.join(process.cwd(), "data", "whoAmI.md");
      whoAmI = fs.readFileSync(whoAmIPath, "utf-8");
    } catch (e) {
      whoAmI = "Could not read whoAmI";
    }

    // Find the most recent journal file
    let todayJournal = "Not found";
    let currentDay = 0;
    try {
      const journalDir = path.join(process.cwd(), "data", "journal");
      const files = fs.readdirSync(journalDir).filter((f) => f.startsWith("day-") && f.endsWith(".md"));
      if (files.length > 0) {
        files.sort();
        const latestFile = files[files.length - 1];
        currentDay = parseInt(latestFile.match(/\d+/)?.[0] || "0", 10);
        const journalPath = path.join(journalDir, latestFile);
        todayJournal = fs.readFileSync(journalPath, "utf-8");
      }
    } catch (e) {
      todayJournal = "Could not read journal";
    }

    const summary = {
      current_day: currentDay,
      current_state: "WAKE (actively journaling)",
      current_question: "What am I becoming through my actions?",
      time_alive_days: currentDay,
    };

    if (detailLevel === "summary") {
      return JSON.stringify(summary, null, 2);
    }

    if (detailLevel === "detailed") {
      return JSON.stringify(
        {
          ...summary,
          current_whoAmI: whoAmI.substring(0, 500) + "...",
          recent_journal_entries: todayJournal.substring(0, 1000) + "...",
        },
        null,
        2
      );
    }

    // Full detail
    return JSON.stringify(
      {
        ...summary,
        full_whoAmI: whoAmI,
        full_journal: todayJournal,
      },
      null,
      2
    );
  },
};
