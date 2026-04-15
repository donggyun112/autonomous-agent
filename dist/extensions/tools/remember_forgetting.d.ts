/**
 * remember_forgetting
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                what_was_lost: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        what_was_lost: string;
    }) => Promise<string>;
};
