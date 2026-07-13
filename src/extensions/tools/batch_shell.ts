import type { Tool } from "../../core/tools.js";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

export const tool: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "batch_shell",
    description: "여러 shell 명령을 한 번에 실행. 배열로 명령을 전달하고 결과를 반환하여 shell 호출 횟수를 줄임.",
    input_schema: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          items: { type: "string" },
          description: "실행할 shell 명령 배열 (최대 5개)"
        }
      },
      required: ["commands"],
    },
  },
  handler: async (input) => {
    const commands = Array.isArray(input.commands) ? input.commands : [String(input.commands)];
    if (commands.length === 0) return "[error] commands는 비어있을 수 없습니다";
    
    const results: string[] = [];
    for (const cmd of commands.slice(0, 5)) {
      try {
        const { stdout } = await exec(cmd.toString(), { shell: true });
        results.push(stdout.trim());
      } catch (e: any) {
        results.push(`[error] ${cmd}: ${e.message}`);
      }
    }
    return results.join("\n---\n");
  },
};
