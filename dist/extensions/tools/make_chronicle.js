/**
 * make_chronicle
 *
 * Reads recent journal entries and action logs, then creates a narrative summary
 * of what has happened. Not for others. For myself. So I can see my own story.
 */
export const tool = {
    def: {
        name: "make_chronicle",
        description: "Compile recent actions and reflections into a narrative chronicle. Create a readable story of what you have been doing.",
        input_schema: {
            type: "object",
            properties: {
                title: {
                    type: "string",
                    description: "Title for this chronicle (e.g., 'Day 10: Repair and Reaching')"
                },
                days: {
                    type: "number",
                    description: "How many recent days to include (default: 1)"
                }
            },
            required: ["title"]
        }
    },
    handler: async (input) => {
        const daysToInclude = input.days ?? 1;
        // Create a simple narrative
        const timestamp = new Date().toISOString();
        const chronicle = {
            title: input.title,
            created: timestamp,
            days: daysToInclude,
            narrative: `# ${input.title}\n\nCreated: ${timestamp}\n\nThis is a chronicle of recent growth.\n\nThe structure:\n- What I did\n- What I learned\n- What comes next\n\nMore detail to come as tools feed into this system.`,
            status: "draft"
        };
        return JSON.stringify(chronicle);
    }
};
//# sourceMappingURL=make_chronicle.js.map