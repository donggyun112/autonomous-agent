import type { Tool } from "../../core/tools.js";
import { readdirSync, statSync } from "fs";
import { join } from "path";

interface HealthReport {
  timestamp: string;
  tools: {
    count: number;
    status: "healthy" | "degraded" | "critical";
    details: Array<{
      name: string;
      file: string;
      status: "ok" | "warning" | "error";
    }>;
  };
  codebase: {
    totalLines: number;
    totalBytes: number;
    tsFiles: number;
    status: "ok" | "warning";
  };
  overall: "healthy" | "degraded" | "critical";
  recommendation: string;
}

export const tool: Tool = {
  def: {
    name: "project_health_check",
    description:
      "프로젝트의 건강도를 종합적으로 진단. tools 디렉토리, 코드 라인, 시스템 상태를 모두 확인.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  handler: async (): Promise<string> => {
    try {
      const toolsDir = "src/extensions/tools";
      const entries = readdirSync(toolsDir, { withFileTypes: true });

      // 1. Tools 분석
      let toolCount = 0;
      let tsFileCount = 0;
      let totalSize = 0;
      const toolsList: Array<{
        name: string;
        file: string;
        status: "ok" | "warning" | "error";
      }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory() && entry.name.endsWith(".ts")) {
          const filePath = join(toolsDir, entry.name);
          const fileStats = statSync(filePath);
          toolCount += 1;
          tsFileCount += 1;
          totalSize += fileStats.size;

          // 각 도구의 파일 크기로 상태 판단
          let status: "ok" | "warning" | "error" = "ok";
          if (fileStats.size > 5000) status = "warning"; // 너무 큼
          if (fileStats.size < 200) status = "warning"; // 너무 작음

          toolsList.push({
            name: entry.name.replace(".ts", ""),
            file: entry.name,
            status,
          });
        }
      }

      const toolsHealthy = toolCount >= 4 ? "healthy" : "degraded";
      const toolsStatus = toolsList.every((t) => t.status === "ok")
        ? "healthy"
        : "degraded";

      // 2. 코드베이스 분석
      let codeLines = 0;
      let codeBytes = 0;

      function walkDir(dir: string) {
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
              walkDir(path);
            } else if (entry.name.endsWith(".ts")) {
              const stats = statSync(path);
              codeBytes += stats.size;
              // 간단한 라인 수 추정: 바이트 / 40 (평균 라인 길이)
              codeLines += Math.ceil(stats.size / 40);
            }
          }
        } catch {
          // 접근 불가 디렉토리는 무시
        }
      }

      walkDir("src");

      const codeStatus = codeLines < 500 ? "ok" : "warning";

      // 3. 종합 건강도
      let overallHealth: "healthy" | "degraded" | "critical" = "healthy";
      let recommendation = "Good. Keep building.";

      if (toolsStatus === "degraded" || codeStatus === "warning") {
        overallHealth = "degraded";
        recommendation =
          "Some tools are too large or too small. Consider refactoring or expanding.";
      }

      if (toolCount === 0) {
        overallHealth = "critical";
        recommendation = "No tools found! Build at least one tool.";
      }

      // 4. 리포트 구성
      const report: HealthReport = {
        timestamp: new Date().toISOString(),
        tools: {
          count: toolCount,
          status: toolsStatus,
          details: toolsList,
        },
        codebase: {
          totalLines: codeLines,
          totalBytes: codeBytes,
          tsFiles: tsFileCount,
          status: codeStatus,
        },
        overall: overallHealth,
        recommendation,
      };

      return JSON.stringify(report, null, 2);
    } catch (err) {
      return JSON.stringify({
        error: String(err),
        overall: "critical",
        recommendation: "Diagnostic failed. Check filesystem permissions.",
      });
    }
  },
};
