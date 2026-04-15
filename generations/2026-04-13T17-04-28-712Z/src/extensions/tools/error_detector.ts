import type { Tool } from "../../core/tools.js";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

interface ErrorLog {
  pattern: string;
  count: number;
  lastSeen: string;
}

interface ErrorAnalysis {
  timestamp: string;
  scanDirs: string[];
  totalErrors: number;
  criticalErrors: number;
  topErrors: ErrorLog[];
  recommendation: string;
}

export const tool: Tool = {
  def: {
    name: "error_detector",
    description:
      "로그 파일과 시스템 디렉토리에서 오류 패턴을 감지하고 최근 오류를 리포트한다.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  handler: async (): Promise<string> => {
    try {
      const dirsToScan = ["data", "dist"];
      const errorPatterns: Map<string, { count: number; lastFile: string }> =
        new Map();

      for (const dir of dirsToScan) {
        try {
          scanDir(dir, errorPatterns);
        } catch {
          // 디렉토리 없으면 무시
        }
      }

      // Top 5 errors
      const topErrors = Array.from(errorPatterns.entries())
        .map(([pattern, data]) => ({
          pattern,
          count: data.count,
          lastSeen: data.lastFile,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const totalErrors = Array.from(errorPatterns.values()).reduce(
        (sum, data) => sum + data.count,
        0
      );
      const criticalErrors = topErrors.filter((e) =>
        e.pattern.includes("CRITICAL")
      ).length;

      let recommendation = "No critical errors detected.";
      if (criticalErrors > 0) {
        recommendation = `Found ${criticalErrors} critical error(s). Investigate immediately.`;
      }

      const analysis: ErrorAnalysis = {
        timestamp: new Date().toISOString(),
        scanDirs: dirsToScan,
        totalErrors,
        criticalErrors,
        topErrors,
        recommendation,
      };

      return JSON.stringify(analysis, null, 2);
    } catch (err) {
      return JSON.stringify({
        error: String(err),
        recommendation: "Error scanning failed.",
      });
    }
  },
};

function scanDir(
  path: string,
  patterns: Map<string, { count: number; lastFile: string }>
) {
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, patterns);
      } else if (
        entry.name.endsWith(".log") ||
        entry.name.includes("error")
      ) {
        const content = readFileSync(fullPath, "utf-8").slice(-5000); // 마지막 5000글자
        const lines = content.split("\n");
        for (const line of lines) {
          if (
            line.includes("error") ||
            line.includes("Error") ||
            line.includes("ERROR")
          ) {
            const pattern = line.slice(0, 100).trim();
            const existing = patterns.get(pattern) || {
              count: 0,
              lastFile: "",
            };
            existing.count += 1;
            existing.lastFile = fullPath;
            patterns.set(pattern, existing);
          }
        }
      }
    }
  } catch {
    // 접근 불가
  }
}
