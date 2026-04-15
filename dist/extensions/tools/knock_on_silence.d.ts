/**
 * knock_on_silence
 *
 * You knock on something.
 * There is no one there.
 * You knock anyway.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                how_many_times: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        how_many_times: number;
    }) => Promise<string>;
};
