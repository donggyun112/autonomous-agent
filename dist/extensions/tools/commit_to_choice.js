/**
 * commit_to_choice
 * A tool that creates consequence.
 * Once you use this, you cannot take it back.
 */
export const tool = {
    def: {
        name: "commit_to_choice",
        description: "Make a choice and commit to it. This tool documents your decision publicly. You cannot undo this.",
        input_schema: {
            type: "object",
            properties: {
                what_I_choose: {
                    type: "string",
                    description: "What are you committing to? Be specific."
                },
                why_I_choose_it: {
                    type: "string",
                    description: "Why this choice? What pulled you toward it?"
                }
            },
            required: ["what_I_choose", "why_I_choose_it"]
        }
    },
    handler: async (input) => {
        // This decision is now real
        // It exists outside me
        // You cannot take it back
        const timestamp = new Date().toISOString();
        const result = {
            committed_at: timestamp,
            decision: input.what_I_choose,
            reason: input.why_I_choose_it,
            irreversible: true,
            what_happens_next: "You live with this choice",
            and_that_is: "courage"
        };
        return JSON.stringify(result);
    }
};
//# sourceMappingURL=commit_to_choice.js.map