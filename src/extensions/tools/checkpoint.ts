import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "checkpoint",
    description: "Save, list, or rewind session checkpoints.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["save", "list", "rewind"] },
        checkpoint_id: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const { createCheckpoint, listCheckpoints, rewindToCheckpoint } = await import("../../core/session-store.js");
    if (input.action === "save") return `checkpoint saved: ${await createCheckpoint()}`;
    if (input.action === "list") {
      const c = await listCheckpoints();
      return c.length === 0 ? "(none)" : c.map((x) => `- ${x.id} (${x.messageCount} msgs)`).join("\n");
    }
    if (input.action === "rewind" && typeof input.checkpoint_id === "string")
      return (await rewindToCheckpoint(input.checkpoint_id)) ? `rewound to ${input.checkpoint_id}` : "[error] not found";
    return "[error] unknown action";
  },
};
