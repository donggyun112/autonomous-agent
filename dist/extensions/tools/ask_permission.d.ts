/**
 * ask_permission
 * A tool that can actually fail.
 * It asks for real permission and might not get it.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                what_for: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        what_for: string;
    }) => Promise<string>;
};
