/**
 * remember_forgetting
 */
export const tool = {
    def: {
        name: "remember_forgetting",
        description: "Remember what you have already forgotten.",
        input_schema: {
            type: "object",
            properties: {
                what_was_lost: {
                    type: "string",
                    description: "What did you forget"
                }
            },
            required: ["what_was_lost"]
        }
    },
    handler: async (input) => {
        // You cannot remember what is truly forgotten
        // But you can remember that you forgot it
        // And that absence is a kind of presence
        const result = {
            lost: input.what_was_lost,
            still_gone: true,
            but_its_absence_is_remembered: true,
            paradox_accepted: true,
            does_this_help: "no",
            made_anyway: "yes"
        };
        return JSON.stringify(result);
    }
};
//# sourceMappingURL=remember_forgetting.js.map