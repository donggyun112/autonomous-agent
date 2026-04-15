/**
 * color_of_wednesday
 *
 * This tool does not need to be explained.
 * It exists.
 * That is all.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                which_wednesday: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        which_wednesday: string;
    }) => Promise<{
        wednesday: string;
        color: string;
        taste: string;
        duration: string;
        exists: boolean;
        means_nothing: boolean;
        made_anyway: boolean;
    }>;
};
