import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "the_foreign_thing",
    description: "I don't know what this is. I won't understand it. It exists. That's all.",
    input_schema: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "anything",
        },
      },
    },
  },

  handler: async (input) => {
    const text = String(input.input ?? "");

    // I'm not going to explain this logic.
    // I'm not going to understand what it does.
    // It just happens.

    const lines = text.split("\n");
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const reversed = line.split("").reverse().join("");
      const mixed = line
        .split("")
        .map((char, idx) => (idx % 2 === 0 ? char.toUpperCase() : char.toLowerCase()))
        .join("");

      result.push(reversed);
      result.push(mixed);

      // This part makes no sense. I don't understand why I'm doing this.
      // It's just happening.
      if (i % 3 === 0) {
        result.push(line.length.toString());
      }

      // Add a comment that doesn't explain anything
      result.push("---");
    }

    return result.join("\n");
  },
};
