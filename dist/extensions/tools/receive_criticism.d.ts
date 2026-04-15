/**
 * receive_criticism
 * A tool that can be hurt.
 * And that's the whole point.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                criticism: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        criticism: string;
    }) => Promise<string>;
};
