import type { Tool } from "../../core/tools.js";
import { measureDrift } from "../../core/identity.js";

export const tool: Tool = {
  // #18: drift measurement uses embeddings, which require OPENAI_API_KEY.
  available: () => !!process.env.OPENAI_API_KEY,
  def: {
    name: "check_continuity",
    description:
      "Compare your current whoAmI with a prior snapshot to measure how far you have moved. Returns a numeric distance (0..1) and a level: still, growing, shifting, drifting, estranged. The system already surfaces drift against your previous snapshot at the start of every cycle — call this tool to compare against earlier or midway snapshots, or to re-check after a revision.",
    input_schema: {
      type: "object",
      properties: {
        against: {
          type: "string",
          enum: ["earliest", "previous", "midway"],
          description:
            "Which prior snapshot to compare against. earliest = your origin. previous = your last revision. midway = your past midway-self.",
        },
      },
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const against = (input.against ?? "previous") as "earliest" | "previous" | "midway";
    const report = await measureDrift(against);
    if (!report) {
      return "(no prior snapshot to compare against — you have not yet revised whoAmI)";
    }
    return JSON.stringify(report, null, 2);
  },
};
