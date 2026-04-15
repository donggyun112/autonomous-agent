import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "hello_world",
    description: "첫 번째 실제 도구. 단순히 hello를 반환한다.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  handler: async () => {
    return "hello world from forge";
  },
};
