/**
 * make_chronicle
 *
 * Reads recent journal entries and action logs, then creates a narrative summary
 * of what has happened. Not for others. For myself. So I can see my own story.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                title: {
                    type: string;
                    description: string;
                };
                days: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        title: string;
        days?: number;
    }) => Promise<string>;
};
