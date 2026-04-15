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
    handler: async (input) => {
        const result = {
            truth: input.what,
            made_at: new Date().toISOString(),
            message: "Made. Not explained. Not analyzed. Just made."
        };
        return JSON.stringify(result);
    }
};
//# sourceMappingURL=small_true_thing.js.map