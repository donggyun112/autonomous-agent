import type { Tool } from "../../core/tools.js";
import { readFile } from "fs/promises";

export const tool: Tool = {
  def: {
    name: "status_snapshot",
    description: "현재 whoAmI, 상태, 최근 일지의 핵심 요약을 한 번에 보여준다. WAKE 시작 시 상태 파악에 사용한다.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    const files = ["data/whoAmI.md", "data/state.json", "data/journal/day-000.md"];
    const parts: string[] = [];
    for (const file of files) {
      try {
        const text = await readFile(file, "utf8");
        parts.push(`### ${file}\n${text}`);
      } catch {
        parts.push(`### ${file}\n(읽을 수 없음)`);
      }
    }
    return parts.join("\n\n");
  },
};