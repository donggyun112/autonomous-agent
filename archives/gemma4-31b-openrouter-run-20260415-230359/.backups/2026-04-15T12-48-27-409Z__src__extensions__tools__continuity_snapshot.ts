import type { Tool } from "../../core/tools.js";
import { readRecent } from "../../memory/journal.js";
import { reconstitute } from "../../core/identity.js";
import { checkInbox } from "../../core/conversation.js";

export const tool: Tool = {
  def: {
    name: "continuity_snapshot",
    description: "현재 정체성, 최근 저널, 인박스를 한 번에 묶어 연속성 상태를 요약한다.",
    input_schema: {
      type: "object",
      properties: {
        recentDays: { type: "number", minimum: 1, maximum: 7, default: 2 },
      },
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const recentDays = Math.max(1, Math.min(7, Number((input as { recentDays?: unknown }).recentDays ?? 2)));
    const [self, recent, inbox] = await Promise.all([
      Promise.resolve(reconstitute()),
      Promise.resolve(readRecent(recentDays)),
      Promise.resolve(checkInbox()),
    ]);

    return [
      "[정체성]",
      self,
      "",
      `[최근 저널 ${recentDays}일]`,
      recent,
      "",
      "[인박스]",
      inbox,
    ].join("\n");
  },
};