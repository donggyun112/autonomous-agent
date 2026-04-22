import type { Tool } from "../../core/tools.js";
import { peekDeadLetter, clearDeadLetterEntry } from "../../core/dead-letter.js";

export const tool: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "retry_failed",
    description: "View/clear failed tool calls from the dead-letter queue.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "clear"] },
        id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    if (input.action === "clear" && typeof input.id === "string")
      return (await clearDeadLetterEntry(input.id)) ? "cleared." : "[error] not found";
    const e = await peekDeadLetter(20);
    return e.length === 0 ? "(no failed operations)" : JSON.stringify(e, null, 2);
  },
};
