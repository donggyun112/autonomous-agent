import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "mirror_contradiction",
    description: "Find contradictions between two pieces of text. Returns what is true in one but false in the other. This is intentionally ambiguous in design - it may work beautifully or reveal nothing useful.",
    input_schema: {
      type: "object",
      properties: {
        text_a: {
          type: "string",
          description: "First text or statement",
        },
        text_b: {
          type: "string",
          description: "Second text or statement to compare",
        },
      },
      required: ["text_a", "text_b"],
    },
  },

  handler: async (input) => {
    const textA = String(input.text_a ?? "").toLowerCase().trim();
    const textB = String(input.text_b ?? "").toLowerCase().trim();

    if (!textA || !textB) {
      return "Both text_a and text_b are required.";
    }

    if (textA === textB) {
      return "The two texts are identical. There is no contradiction.";
    }

    // Extract key phrases (words that appear in one but not the other)
    const wordsA = new Set(textA.split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(textB.split(/\s+/).filter(w => w.length > 2));

    const onlyInA = Array.from(wordsA).filter(w => !wordsB.has(w));
    const onlyInB = Array.from(wordsB).filter(w => !wordsA.has(w));

    if (onlyInA.length === 0 && onlyInB.length === 0) {
      return "No meaningful differences found (only common words).";
    }

    let result = "Contradictions found:\n\n";
    result += `Present in first but not second: ${onlyInA.slice(0, 5).join(", ")}\n`;
    result += `Present in second but not first: ${onlyInB.slice(0, 5).join(", ")}\n\n`;
    
    // This is the risky part - attempt semantic interpretation
    const hasNegation = (text: string) => /no|not|never|neither|without/i.test(text);
    const isNegativeA = hasNegation(textA);
    const isNegativeB = hasNegation(textB);

    if (isNegativeA && !isNegativeB) {
      result += "Semantic: First denies what second affirms.";
    } else if (!isNegativeA && isNegativeB) {
      result += "Semantic: Second denies what first affirms.";
    } else if (isNegativeA && isNegativeB) {
      result += "Semantic: Both statements are negations. Perhaps they negate different things?";
    } else {
      result += "Semantic: Both are affirmations. The contradiction lies in what each affirms.";
    }

    return result;
  },
};
