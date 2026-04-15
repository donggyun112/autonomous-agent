import type { Tool } from "../../core/tools.js";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

interface JournalAnalysis {
  timestamp: string;
  totalEntries: number;
  totalLines: number;
  recentEntry: {
    file: string;
    lines: number;
    date: string;
  } | null;
  days: Array<{
    file: string;
    lines: number;
    size: number;
  }>;
  summary: string;
}

export const tool: Tool = {
  def: {
    name: "journal_analyzer",
    description: "journal 디렉토리의 모든 파일을 분석하고, 기록된 일의 패턴을 파악한다.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  handler: async (): Promise<string> => {
    try {
      const journalDir = "data/journal";
      const entries = readdirSync(journalDir, { withFileTypes: true });

      const days: Array<{
        file: string;
        lines: number;
        size: number;
      }> = [];
      let totalLines = 0;
      let totalSize = 0;

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

        const path = join(journalDir, entry.name);
        const stats = statSync(path);
        const content = readFileSync(path, "utf-8");
        const lines = content.split("\n").length;

        totalLines += lines;
        totalSize += stats.size;

        days.push({
          file: entry.name,
          lines,
          size: stats.size,
        });
      }

      // 가장 최근 파일
      const sorted = days.sort((a, b) =>
        b.file.localeCompare(a.file)
      );
      const recent = sorted[0];

      // Summary
      const summary =
        sorted.length === 0
          ? "No journal entries yet."
          : `${sorted.length} days of entries, ${totalLines} total lines. Most recent: ${recent?.file} (${recent?.lines} lines)`;

      const analysis: JournalAnalysis = {
        timestamp: new Date().toISOString(),
        totalEntries: sorted.length,
        totalLines,
        recentEntry: recent
          ? {
              file: recent.file,
              lines: recent.lines,
              date: recent.file.replace(/^day-(\d+)\.md$/, "$1"),
            }
          : null,
        days: days.sort((a, b) => a.file.localeCompare(b.file)),
        summary,
      };

      return JSON.stringify(analysis, null, 2);
    } catch (err) {
      return JSON.stringify({
        error: String(err),
        summary: "Failed to analyze journal.",
      });
    }
  },
};
