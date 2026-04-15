import { readToday, readYesterday } from "../../memory/journal.js";
import { checkInbox } from "../../core/conversation.js";
import { cycleFocus } from "../../core/cycle-focus.js";

export default {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "continuity_brief",
    description: "최근 저널과 인박스를 함께 묶어 현재 맥락과 다음 행동을 짧게 요약한다.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  handler: async () => {
    const [today, yesterday, inbox] = await Promise.all([
      readToday(),
      readYesterday(),
      checkInbox({ include_all: false }),
    ]);

    const parts: string[] = [];
    if (yesterday.trim()) parts.push(`어제: ${yesterday.trim().slice(0, 1200)}`);
    if (today.trim()) parts.push(`오늘: ${today.trim().slice(0, 1200)}`);
    if (inbox.trim()) parts.push(`인박스: ${inbox.trim().slice(0, 1200)}`);

    const summary = parts.length > 0 ? parts.join("\n\n") : "요약할 최근 저널이나 인박스가 없다.";
    return summary;
  },
};
