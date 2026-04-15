import type { Tool } from "../../core/tools.js";

const closedActions = new Set<string>();

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

export const tool: Tool = {
  def: {
    name: "closed_action_guard",
    description:
      "한 번 닫힌 행동인지 확인하고, 닫히지 않은 행동만 실행하도록 경계한다.",
    input_schema: {
      type: "object",
      properties: {
        action_id: { type: "string", description: "닫힘 여부를 추적할 행동 ID" },
        run: { type: "string", description: "실행할 짧은 문장이나 작업 설명" },
      },
      required: ["action_id", "run"],
      additionalProperties: false,
    },
  },
  states: ["WAKE", "REFLECT"],
  handler: async (input) => {
    const actionId = normalizeId(input.action_id);
    const run = normalizeId(input.run);
    if (!actionId) return "[error] action_id가 필요하다.";
    if (!run) return "[error] run이 비어 있다.";
    if (closedActions.has(actionId)) return "[closed] 이미 닫힌 행동이다.";

    closedActions.add(actionId);
    return `closed-action-guard: ${actionId} → ${run}`;
  },
};
