import type { Tool } from "../../core/tools.js";
import { writeFile } from "fs/promises";
import { join } from "path";
import { DATA } from "../../primitives/paths.js";

export const tool: Tool = {
  def: {
    name: "wake-ack-verify",
    description: "깨어난 직후 wake_ack 뒤에 실제 행동이 붙었는지 짧은 로그로 검증한다.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "검증할 짧은 메모" },
      },
      required: ["note"],
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const note = String(input.note ?? "").trim();
    const dir = join(DATA, "notes");
    const file = join(dir, "wake-ack-verify.log");
    await writeFile(file, `${new Date().toISOString()}\n${note}\n`, "utf-8");
    return `wake-ack-verify 기록됨: ${file}`;
  },
};
