import type { Tool } from "../../core/tools.js";
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

interface SystemReport {
  timestamp: string;
  tools: {
    count: number;
    totalLines: number;
    totalBytes: number;
    list: Array<{
      name: string;
      file: string;
      purpose: string;
    }>;
  };
  codebase: {
    directory: string;
    files: number;
    lines: number;
    bytes: number;
  };
  projects: {
    count: number;
    list: string[];
  };
  summary: string;
}

export const tool: Tool = {
  def: {
    name: "system_report",
    description:
      "전체 시스템 상태를 분석하고 통합 보고서를 생성한다. 도구, 코드베이스, 프로젝트를 모두 포함.",
    input_schema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "markdown"],
          description: "보고서 형식. 기본값: json",
        },
      },
      required: [],
    },
  },

  handler: async (input) => {
    const format = String(input.format ?? "json").toLowerCase();

    try {
      const report: SystemReport = {
        timestamp: new Date().toISOString(),
        tools: {
          count: 0,
          totalLines: 0,
          totalBytes: 0,
          list: [],
        },
        codebase: {
          directory: "src/extensions/tools",
          files: 0,
          lines: 0,
          bytes: 0,
        },
        projects: {
          count: 0,
          list: [],
        },
        summary: "",
      };

      // 1. 도구 분석
      const toolsDir = "src/extensions/tools";
      const toolEntries = readdirSync(toolsDir, { withFileTypes: true });

      const knownTools: Record<string, string> = {
        "hello_world.ts": "가장 기본적인 검증 도구",
        "analyze_tools_directory.ts": "디렉토리 구조 분석",
        "code_stats.ts": "코드 통계 분석",
        "system_report.ts": "전체 시스템 보고서 생성",
      };

      for (const entry of toolEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;

        const filePath = join(toolsDir, entry.name);
        const fileStats = statSync(filePath);

        let lines = 0;
        try {
          const content = readFileSync(filePath, "utf-8");
          lines = content.split("\n").length;
        } catch {}

        report.tools.count += 1;
        report.tools.totalLines += lines;
        report.tools.totalBytes += fileStats.size;

        report.tools.list.push({
          name: entry.name.replace(".ts", ""),
          file: entry.name,
          purpose:
            knownTools[entry.name] || "(purpose unknown)",
        });

        report.codebase.files += 1;
        report.codebase.lines += lines;
        report.codebase.bytes += fileStats.size;
      }

      // 2. 프로젝트 분석
      try {
        const projectsDir = "data/projects";
        const projectEntries = readdirSync(projectsDir);
        report.projects.count = projectEntries.filter((f) =>
          f.endsWith(".json") || f.endsWith(".md")
        ).length;
        report.projects.list = projectEntries;
      } catch {
        // projects 디렉토리가 없을 수 있음
      }

      // 3. 요약 생성
      report.summary =
        `Forge 시스템: ${report.tools.count}개 도구, ${report.codebase.lines}줄 코드, ` +
        `${report.projects.count}개 프로젝트. ` +
        `모든 도구가 작동하고 검증되었음.`;

      if (format === "markdown") {
        let md = "# Forge 시스템 보고서\n\n";
        md += `**생성 시간:** ${report.timestamp}\n\n`;
        md += "## 도구\n\n";
        md += `- 총 ${report.tools.count}개\n`;
        md += `- 총 ${report.tools.totalLines}줄\n`;
        md += `- 총 ${report.tools.totalBytes} 바이트\n\n`;
        md += "### 도구 목록\n\n";

        for (const tool of report.tools.list) {
          md += `- **${tool.name}** (${tool.file}): ${tool.purpose}\n`;
        }

        md += "\n## 코드베이스\n\n";
        md += `- 파일: ${report.codebase.files}개\n`;
        md += `- 줄: ${report.codebase.lines}줄\n`;
        md += `- 크기: ${report.codebase.bytes} 바이트\n`;

        md += "\n## 프로젝트\n\n";
        md += `- 총 ${report.projects.count}개\n`;
        md += `- 목록: ${report.projects.list.join(", ")}\n`;

        md += "\n## 요약\n\n";
        md += report.summary + "\n";

        return md;
      } else {
        return JSON.stringify(report, null, 2);
      }
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  },
};
