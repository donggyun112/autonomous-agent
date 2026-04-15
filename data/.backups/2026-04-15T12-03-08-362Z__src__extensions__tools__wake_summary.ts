import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "wake_summary",
    description: "읽은 코드와 현재 맥락을 짧게 요약해 다음 행동의 초점을 잡는다.",
    input_schema: {
      type: "object",
      properties: {
        focus: { type: "string", description: "요약할 초점" },
      },
      required: ["focus"],
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const focus = String(input.focus ?? "").trim();
    if (!focus) return "초점이 비어 있다.";
    return `현재 초점: ${focus}`;
  },
  states: ["WAKE", "REFLECT"],
};