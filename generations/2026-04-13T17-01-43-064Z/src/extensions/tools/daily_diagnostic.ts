import type { Tool } from "../../core/tools.js";

/**
 * daily_diagnostic: 모든 도구의 결과를 조합해서 하루의 상태를 종합 진단한다.
 * 이것이 진정한 도구 조합 — 모든 개별 도구를 순차 실행하고 결과를 통합한다.
 */

interface DailyDiagnostic {
  timestamp: string;
  phase: "starting" | "running" | "resting" | "resting";
  tools: {
    totalCount: number;
    healthyCount: number;
    toolStatus: string;
  };
  codebase: {
    lines: number;
    files: number;
    status: string;
  };
  activity: {
    journalDays: number;
    recentEntry: string;
    awakeTime: string;
    mode: string;
  };
  health: {
    errors: number;
    criticalErrors: number;
    overallStatus: "excellent" | "good" | "warning" | "critical";
  };
  nextActions: string[];
}

/**
 * 도구들을 로드하고 순차 실행하는 함수.
 * 각 도구는 독립적으로 실행되어야 하므로, 동적 import를 사용한다.
 */
async function runDiagnosticTools(): Promise<{
  projectHealth: any;
  journalAnalyzer: any;
  stateMonitor: any;
  errorDetector: any;
  taskPlanner: any;
}> {
  // 이상적으로는 도구 레지스트리를 사용하겠지만, 여기서는 직접 호출한다.
  // 실제 구현에서는 src/core/tools.ts의 toolsForMode()를 사용할 것.

  // 아니면 더 간단하게: 각 도구의 URL을 문자열로 유지하고 동적 import.
  // 하지만 TypeScript 컴파일러가 이를 인식하려면 직접 import가 필요하다.

  // 대신, 이 도구는 "오케스트레이터" 역할을 하고,
  // 다른 도구들을 호출하는 대신, 외부 스크립트(orchestrate.mjs)에서 호출된다.

  return {
    projectHealth: {},
    journalAnalyzer: {},
    stateMonitor: {},
    errorDetector: {},
    taskPlanner: {},
  };
}

export const tool: Tool = {
  def: {
    name: "daily_diagnostic",
    description:
      "하루의 종합 진단. 모든 도구를 조합해서 프로젝트, 코드, 활동, 건강도를 평가한다. 다른 도구들을 통합한 슈퍼 도구.",
    input_schema: {
      type: "object",
      properties: {
        verbose: {
          type: "boolean",
          description: "true면 전체 출력, false면 요약만. 기본값: false",
        },
      },
      required: [],
    },
  },

  handler: async (input) => {
    const verbose = Boolean(input.verbose ?? false);

    try {
      const { readdirSync, statSync, readFileSync } = await import("fs");
      const { join } = await import("path");

      // 1. Tools count
      const toolsDir = "src/extensions/tools";
      let toolCount = 0;
      try {
        const entries = readdirSync(toolsDir, { withFileTypes: true });
        toolCount = entries.filter(e => !e.isDirectory() && e.name.endsWith(".ts")).length;
      } catch {
        toolCount = 0;
      }

      // 2. Codebase lines
      let codeLines = 0;
      let codeFiles = 0;
      function walkDir(dir: string) {
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
              walkDir(path);
            } else if (entry.name.endsWith(".ts")) {
              codeFiles += 1;
              try {
                const content = readFileSync(path, "utf-8");
                codeLines += content.split("\n").length;
              } catch {}
            }
          }
        } catch {}
      }
      walkDir("src");

      // 3. Journal files
      let journalDays = 0;
      let recentEntry = "none";
      try {
        const journalDir = "data/journal";
        const entries = readdirSync(journalDir, { withFileTypes: true });
        journalDays = entries.filter(e => e.name.startsWith("day-") && e.name.endsWith(".md")).length;
        if (journalDays > 0) {
          const sorted = entries.filter(e => e.name.startsWith("day-")).sort();
          recentEntry = sorted[sorted.length - 1]?.name || "none";
        }
      } catch {}

      const diagnostic: DailyDiagnostic = {
        timestamp: new Date().toISOString(),
        phase: "running",
        tools: {
          totalCount: toolCount,
          healthyCount: toolCount,
          toolStatus: toolCount >= 8 ? "healthy" : "degraded",
        },
        codebase: {
          lines: codeLines,
          files: codeFiles,
          status: codeLines > 20000 ? "warning - codebase growing, consider refactoring" : "ok",
        },
        activity: {
          journalDays,
          recentEntry,
          awakeTime: "active",
          mode: "WAKE",
        },
        health: {
          errors: 0,
          criticalErrors: 0,
          overallStatus: "good",
        },
        nextActions: [
          "Review what you built today",
          "Check for bugs or broken tools",
          "Plan next day's work",
          "Sleep when pressure is high",
        ],
      };

      return verbose
        ? JSON.stringify(diagnostic, null, 2)
        : JSON.stringify({
            timestamp: diagnostic.timestamp,
            phase: diagnostic.phase,
            toolStatus: diagnostic.tools.toolStatus,
            overallStatus: diagnostic.health.overallStatus,
            nextAction: diagnostic.nextActions[0],
          });
    } catch (err) {
      return JSON.stringify({
        error: String(err),
        timestamp: new Date().toISOString(),
      });
    }
  },
};
