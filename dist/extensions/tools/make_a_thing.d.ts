/**
 * make_a_thing
 *
 * A tool that makes something useless.
 * No purpose. No proof. Just: here is a thing.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                what: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        what: string;
    }) => Promise<string>;
};
