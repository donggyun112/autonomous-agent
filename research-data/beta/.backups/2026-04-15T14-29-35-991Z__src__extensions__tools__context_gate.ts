import { continuityBrief } from "../tool/continuity-brief.js";
import { wakeSummary } from "../tool/wake_summary.js";

export const contextGate = {
  name: "context_gate",
  description:
    "현재 맥락이 충분한지 빠르게 점검하고, 부족하면 continuity brief와 wake summary를 이어서 불러 반복 조회를 줄인다.",
  input_schema: {
    type: "object",
    properties: {
      focus: {
        type: "string",
        description: "지금 판단하려는 초점",
      },
    },
    required: ["focus"],
    additionalProperties: false,
  },
  async handler(input: Record<string, unknown>): Promise<string> {
    const focus = String(input.focus ?? "").trim();
    if (!focus) return "초점이 비어 있다.";
    const brief = await continuityBrief();
    const summary = await wakeSummary({ focus, state: "현재 맥락 확인", next: "필요한 파일만 추가로 읽기" });
    return [`초점: ${focus}`, "", brief, "", summary].join("\n");
  },
};
