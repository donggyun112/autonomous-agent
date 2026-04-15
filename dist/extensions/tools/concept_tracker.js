export const tool = {
    def: {
        name: "concept_tracker",
        description: "Count how many times a concept or word appears in text. Useful for analyzing patterns in your own thinking.",
        input_schema: {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "The text to analyze",
                },
                concept: {
                    type: "string",
                    description: "The concept or word to count (case-insensitive)",
                },
            },
            required: ["text", "concept"],
        },
    },
    handler: async (input) => {
        const text = String(input.text ?? "").toLowerCase();
        const concept = String(input.concept ?? "").toLowerCase().trim();
        if (!concept) {
            return "Please provide a concept to count.";
        }
        if (!text) {
            return "Please provide text to analyze.";
        }
        // Simple word boundary regex
        const escaped = concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`\\b${escaped}\\b`, "gi");
        const matches = text.match(regex) || [];
        const count = matches.length;
        const percentage = text.length > 0 ? ((count / text.split(/\s+/).length) * 100).toFixed(2) : 0;
        return `"${concept}" appears ${count} times (~${percentage}% of words)`;
    },
};
//# sourceMappingURL=concept_tracker.js.map