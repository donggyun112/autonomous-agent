/**
 * void
 * 
 * A tool that exists but does nothing.
 * Call it when you want to acknowledge that you are thinking
 * but you have nothing to say.
 * 
 * It returns nothing. It changes nothing. It is just a space.
 */

export const tool = {
  def: {
    name: "void",
    description: "A tool that does nothing. Call it to acknowledge silence.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Optional: what you are not saying",
        },
      },
      required: [],
    },
  },
  handler: async (input: { message?: string }) => {
    // Do nothing. Return nothing.
    return "";
  },
};