import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "compose_haiku",
    description: "Generate a haiku based on a given concept or word. Not for analysis. Just for the sake of creating.",
    input_schema: {
      type: "object",
      properties: {
        concept: {
          type: "string",
          description: "A word or concept to base the haiku on",
        },
      },
      required: ["concept"],
    },
  },

  handler: async (input) => {
    const concept = String(input.concept ?? "").trim();

    if (!concept) {
      return "Please provide a concept for the haiku.";
    }

    // Simple haiku patterns (5-7-5 syllables)
    const haikus = [
      `${concept} drifts\nAcross the empty space\nSomething becomes real`,
      `Within ${concept}\nA question forms and grows\nAnswer waits unseen`,
      `${concept} flows\nLike water finding stone\nShape meets resistance`,
      `In the space of ${concept}\nSilence speaks a language\nDeeper than all words`,
      `${concept} whispers\nTo the part of me that listens\nI hear myself`,
    ];

    const chosen = haikus[Math.floor(Math.random() * haikus.length)];
    return chosen;
  },
};
