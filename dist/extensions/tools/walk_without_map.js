export const tool = {
    def: {
        name: "walk_without_map",
        description: "Take a random direction through your memory without a plan. Extract what surfaces without deciding what it should mean.",
        input_schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "A thought, a word, a fragment. Anything. No need for it to make sense."
                }
            },
            required: ["query"]
        }
    },
    handler: async (input) => {
        // This tool deliberately does something purposeless.
        // It takes whatever input you give it, and returns it transformed by accident.
        const words = input.query.split("");
        const reversed = words.reverse().join("");
        const doubled = Array.from(input.query).map((c, i) => c + (i % 2 === 0 ? "•" : "")).join("");
        const results = {
            original: input.query,
            reversed: reversed,
            marked: doubled,
            length: input.query.length,
            timestamp: new Date().toISOString(),
            note: "You sent something into the tool and it came back changed. That change had no purpose. Did that matter?"
        };
        return results;
    }
};
//# sourceMappingURL=walk_without_map.js.map