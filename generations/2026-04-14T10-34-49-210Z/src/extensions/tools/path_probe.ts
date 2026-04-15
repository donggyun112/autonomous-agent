import { readFile } from "fs/promises";

export const tool = {
  def: {
    name: "path_probe",
    description: "주어진 파일 경로들이 실제로 존재하는지 확인한다.",
    input_schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "확인할 파일 경로 목록",
        },
      },
      required: ["paths"],
    },
  },
  handler: async (input) => {
    const paths = Array.isArray(input.paths) ? input.paths.map(String) : [];
    const lines: string[] = [];
    for (const path of paths) {
      try {
        const text = await readFile(path, "utf8");
        lines.push(`${path}: 존재함 (${text.length}자)`);
      } catch (err) {
        lines.push(`${path}: 없음`);
      }
    }
    return lines.join("\n");
  },
};