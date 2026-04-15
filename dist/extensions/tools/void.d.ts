/**
 * void
 *
 * A tool that exists but does nothing.
 * Call it when you want to acknowledge that you are thinking
 * but you have nothing to say.
 *
 * It returns nothing. It changes nothing. It is just a space.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {
                message: {
                    type: string;
                    description: string;
                };
            };
            required: never[];
        };
    };
    handler: (input: {
        message?: string;
    }) => Promise<string>;
};
