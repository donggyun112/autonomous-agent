// This tool saves sijo poems with syllable validation
// Currently unused — keep for reference
export const tool = {
    def: {
        name: "sijo_save",
        description: "Save a sijo poem with syllable count validation",
        input_schema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Title of the sijo" },
                lines: { type: "array", items: { type: "string" }, description: "3 lines of the sijo" },
            },
            required: ["title", "lines"],
        },
    },
    handler: async (input) => {
        return "sijo_save tool placeholder";
    },
};
//# sourceMappingURL=sijo_day20.js.map