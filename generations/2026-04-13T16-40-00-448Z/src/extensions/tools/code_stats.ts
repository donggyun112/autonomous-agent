import type { Tool } from "../../core/tools.js";
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

interface CodeStats {
  directory: string;
  totalFiles: number;
  totalLines: number;
  totalBytes: number;
  fileTypes: Record<string, number>;
  files: Array<{
    name: string;
    lines: number;
    bytes: number;
    type: string;
  }>;
}

export const tool: Tool = {
  def: {
    name: "code_stats",
    description:
      "주어진 디렉토리의 코드 통계를 분석한다. 파일 수, 줄 수, 바이트 수를 계산한다.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "분석할 디렉토리 경로",
        },
        extensions: {
          type: "string",
          description: "분석할 파일 확장자 (쉼표로 구분, 예: 'ts,js,md')",
        },
      },
      required: ["path"],
    },
  },

  handler: async (input) => {
    const dirPath = String(input.path ?? ".");
    const filterExts = input.extensions
      ? String(input.extensions).split(",").map((e) => e.trim())
      : null;

    try {
      const stats: CodeStats = {
        directory: dirPath,
        totalFiles: 0,
        totalLines: 0,
        totalBytes: 0,
        fileTypes: {},
        files: [],
      };

      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) continue;

        const ext = entry.name.split(".").pop() || "unknown";

        // 필터링
        if (filterExts && !filterExts.includes(ext)) {
          continue;
        }

        const filePath = join(dirPath, entry.name);
        const fileStats = statSync(filePath);

        // 파일 내용 읽기
        let lines = 0;
        try {
          const content = readFileSync(filePath, "utf-8");
          lines = content.split("\n").length;
        } catch {
          // 바이너리 파일이나 읽기 불가능한 파일은 무시
        }

        stats.totalFiles += 1;
        stats.totalLines += lines;
        stats.totalBytes += fileStats.size;
        stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;

        stats.files.push({
          name: entry.name,
          lines,
          bytes: fileStats.size,
          type: ext,
        });
      }

      // 파일 크기 기준으로 정렬
      stats.files.sort((a, b) => b.bytes - a.bytes);

      return JSON.stringify(stats, null, 2);
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  },
};
