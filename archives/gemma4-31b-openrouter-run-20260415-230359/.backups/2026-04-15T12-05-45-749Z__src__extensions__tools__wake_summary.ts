import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "wake_summary",
    description: "읽은 코드와 현재 맥락을 핵심 상태·리스크·다음 행동으로 짧게 압축한다.",
    input_schema: {
      type: "object",
      properties: {
        focus: { type: "string", description: "요약할 초점" },
        state: { type: "string", description: "현재 상태" },
        risk: { type: "string", description: "현재 리스크" },
        decision: { type: "string", description: "지금 미루고 있는 결정" },
        next: { type: "string", description: "추천 다음 행동" },
      },
      required: ["focus"],
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const focus = String(input.focus ?? "").trim();
    const state = String(input.state ?? "").trim();
    const risk = String(input.risk ?? "").trim();
    const decision = String(input.decision ?? "").trim();
    const next = String(input.next ?? "").trim();

    const parts: string[] = [];
    if (focus) parts.push(`초점: `);
    if (state) parts.push(`상태: `);
    if (risk) parts.push(`리스크: `);
    if (decision) parts.push(`미룬 결정: `);
    if (next) parts.push(`다음: `);

    return parts.length ? parts.join(" | ") : "초점이 비어 있다.";
  },
  states: ["WAKE", "REFLECT"],
};