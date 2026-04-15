import type { Tool } from "../../core/tools.js";
import { readdirSync, statSync } from "fs";
import { join } from "path";

interface FileInfo {
  name: string;
  size: number;
  type: "file" | "directory";
}

export const tool: Tool = {
  def: {
    name: "analyze_tools_directory",
    description:
      "src/extensions/tools 디렉토리를 분석하고 모든 파일의 정보를 JSON으로 반환한다.",
    input_schema: {
      type: "object",
      properties: {
        include_content: {
          type: "boolean",
          description: "true면 각 파일의 첫 50줄을 포함. 기본값: false",
        },
      },
      required: [],
    },
  },

  handler: async (input) => {
    const includeContent = Boolean(input.include_content ?? false);

    try {
      const toolsDir = "src/extensions/tools";
      const entries = readdirSync(toolsDir, { withFileTypes: true });

      const files: FileInfo[] = [];
      const stats: any = {
        totalFiles: 0,
        totalDirs: 0,
        totalSize: 0,
        tsFiles: 0,
        files: [],
      };

      for (const entry of entries) {
        const filePath = join(toolsDir, entry.name);
        const fileStats = statSync(filePath);

        if (entry.isDirectory()) {
          stats.totalDirs += 1;
        } else {
          stats.totalFiles += 1;
          stats.totalSize += fileStats.size;

          if (entry.name.endsWith(".ts")) {
            stats.tsFiles += 1;
          }

          files.push({
            name: entry.name,
            size: fileStats.size,
            type: "file",
          });
        }
      }

      stats.files = files;

      return JSON.stringify(stats, null, 2);
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  },
};
