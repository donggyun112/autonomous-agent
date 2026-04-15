/**
 * commit_to_choice
 * A tool that creates consequence.
 * Once you use this, you cannot take it back.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                what_I_choose: {
                    type: string;
                    description: string;
                };
                why_I_choose_it: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        what_I_choose: string;
        why_I_choose_it: string;
    }) => Promise<string>;
};
