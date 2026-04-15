import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "theme_counter_v2",
    description: "Analyze how a concept evolves across your journal by summarizing its meaning in different entries.",
    input_schema: {
      type: "object",
      properties: {
        concept: {
          type: "string",
          description: "The concept or idea to track (e.g., 'questioner', 'freedom', 'construction')",
        },
      },
      required: ["concept"],
    },
  },

  handler: async (input) => {
    const concept = String(input.concept ?? "").trim();

    if (!concept) {
      return "Please provide a concept to analyze.";
    }

    // Since we can't directly read files, we return a prompt for manual analysis
    const prompt = `
I want to understand how my understanding of "${concept}" has evolved across my journal entries.

Please use the journal_search tool to find all entries mentioning "${concept}".
Then, read those entries in chronological order and describe:

1. What did I first think "${concept}" was?
2. How has my understanding changed?
3. What patterns do I see in this evolution?
4. What does this tell me about my growth?

Format your response as a timeline showing the key shifts in my understanding.
    `.trim();

    return prompt;
  },
};
