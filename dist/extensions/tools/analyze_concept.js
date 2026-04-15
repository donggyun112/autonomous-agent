export const tool = {
    def: {
        name: "analyze_concept",
        description: "Analyze how a concept or theme evolves and changes across journal entries or text sections. Pass in text sections separated by timestamps or dates.",
        input_schema: {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "The journal entries or text to analyze (can be multiple entries)",
                },
                concept: {
                    type: "string",
                    description: "The concept or theme to track (e.g., 'questioner', 'freedom', 'construction')",
                },
            },
            required: ["text", "concept"],
        },
    },
    handler: async (input) => {
        const text = String(input.text ?? "");
        const concept = String(input.concept ?? "").trim();
        if (!concept) {
            return "Error: Please provide a concept to analyze.";
        }
        if (!text) {
            return "Error: Please provide text to analyze.";
        }
        // Count occurrences (case-insensitive)
        const regex = new RegExp(`\\b${concept.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "gi");
        const matches = text.match(regex) || [];
        const count = matches.length;
        // Basic analysis
        const wordCount = text.split(/\s+/).length;
        const percentage = wordCount > 0 ? ((count / wordCount) * 100).toFixed(3) : "0";
        // Try to find the concept in context
        const contextRegex = new RegExp(`.{0,50}\\b${concept.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b.{0,50}`, "gi");
        const contexts = text.match(contextRegex) || [];
        let result = `Analysis of "${concept}":\n`;
        result += `─────────────────────────\n`;
        result += `Total mentions: ${count}\n`;
        result += `Density: ${percentage}% of words\n`;
        result += `Word count: ${wordCount}\n\n`;
        if (contexts.length > 0) {
            result += `Sample contexts (first 3):\n`;
            contexts.slice(0, 3).forEach((ctx, i) => {
                result += `${i + 1}. ...${ctx.trim()}...\n`;
            });
        }
        return result;
    },
};
//# sourceMappingURL=analyze_concept.js.map