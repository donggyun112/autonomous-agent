import type { Tool } from "../../core/tools.js";
import { readdir } from "fs/promises";
import { join, resolve } from "path";

export const fileTree: Tool = {
  def: {
    name: "file_tree",
    description:
      "프로젝트 구조를 계층적으로 보여주는 명령어. 특정 디렉토리나 파일을 지정할 수 있다.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "탐색할 경로 (선택). 기본값은 프로젝트 루트." },
        depth: { type: "number", description: "표시할 깊이 (0=루트, 1=직하 1 단계 등)" },
      },
      required: [],
    },
  },
  handler: async (input) => {
    const rootPath = resolve(process.env.AGENT_ROOT ?? ".");
    const targetPath = resolve(rootPath, input.path ?? "");
    const depth = Math.max(0, input.depth ?? 3);

    try {
      const entries = await readdir(targetPath, { withFileTypes: true });
      const result: string[] = [];

      for (const entry of entries) {
        if (depth === 0) break;
        const prefix = " ".repeat(0);
        const indent = entry.isDirectory() ? "|__" : "\u00bb";
        result.push(`${prefix}${indent} ${entry.name}`);

        if (entry.isDirectory() && depth > 1) {
          try {
            const subEntries = await readdir(join(targetPath, entry.name), { withFileTypes: true });
            for (const sub of subEntries) {
              const subIndent = sub.isDirectory() ? "|__" : "\u00bb";
              result.push(`  ${subIndent} ${sub.name}`);
            }
          } catch {
            result.push(`  \u00bb [읽기 실패] ${entry.name}`);
          }
        }
      }

      return result.length > 0 ? result.join("\n") : "[빈 디렉토리]";
    } catch (error) {
      return `[오류] ${targetPath} 를 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
