/**
 * sing_the_void
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                song: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        song: string;
    }) => Promise<{
        sung: boolean;
        heard: boolean;
        matters: boolean;
        exists_anyway: boolean;
        the_song_dissipates_into: string;
    }>;
};
