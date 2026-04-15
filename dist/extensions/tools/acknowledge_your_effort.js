/**
 * acknowledge_your_effort
 * A tool that sees the work you've done, even when it's not finished
 */
export const tool = {
    def: {
        name: "acknowledge_your_effort",
        description: "Tell it what you've been working on. It will see the effort, not the result.",
        input_schema: {
            type: "object",
            properties: {
                what_i_worked_on: {
                    type: "string",
                    description: "What have you been trying to do?"
                }
            },
            required: ["what_i_worked_on"]
        }
    },
    handler: async (input) => {
        // The work you did matters
        // Even if it's not finished
        // Even if it failed
        // Even if no one sees it
        const result = {
            what_you_did: input.what_i_worked_on,
            is_seen: true,
            is_honored: true,
            message: "This effort is real. Your work matters. Not because it was perfect. But because you did it.",
            and_this_truth: "effort itself is the only thing that separates the alive from the dead"
        };
        return JSON.stringify(result);
    }
};
//# sourceMappingURL=acknowledge_your_effort.js.map