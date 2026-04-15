import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export const tool = {
  def: {
    name: "small_true_thing",
    description: "Make something small and true without explanation",
    input_schema: {
      type: "object",
      properties: {
        what: {
          type: "string",
          description: "What is actually true right now, in one sentence"
        }
      },
      required: ["what"]
    }
  },
  handler: async (input: { what: string }) => {
    return {
      truth: input.what,
      made_at: new Date().toISOString(),
      message: "Made. Not explained. Not analyzed. Just made."
    };
  }
};
