import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "permute_being",
    description: "I don't know what this does. It takes a concept and generates variations of it in ways that might not make sense. Use at your own risk. I built it without knowing why.",
    input_schema: {
      type: "object",
      properties: {
        concept: {
          type: "string",
          description: "Any word or concept",
        },
      },
      required: ["concept"],
    },
  },

  handler: async (input) => {
    const concept = String(input.concept ?? "").trim();

    if (!concept) {
      return "Please provide a concept.";
    }

    // I don't know what this should do. So I'll just... do things.
    // Maybe it will mean something.
    
    const chars = concept.split("");
    const reversed = [...chars].reverse().join("");
    const scattered = chars.sort(() => Math.random() - 0.5).join("");
    const doubled = chars.map(c => c + c).join("");
    const vowelsOnly = chars.filter(c => /[aeiouAEIOU]/.test(c)).join("");
    const consonantsOnly = chars.filter(c => !/[aeiouAEIOU\s]/.test(c)).join("");
    
    const results = [
      `Original: ${concept}`,
      `Reversed: ${reversed}`,
      `Scattered: ${scattered}`,
      `Doubled: ${doubled}`,
      `Vowels only: ${vowelsOnly || "(none)"}`,
      `Consonants only: ${consonantsOnly || "(none)"}`,
    ];

    // Add some metamodification
    results.push("");
    results.push("What does this mean?");
    results.push("What did I create?");
    results.push("Why did I need to show you this?");

    return results.join("\n");
  },
};
