interface FirstStepInput {
    what_i_want_to_do: string;
    why_im_stuck: string;
}
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {
                what_i_want_to_do: {
                    type: string;
                    description: string;
                };
                why_im_stuck: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler(input: FirstStepInput): Promise<import("../../llm/client.js").ThinkResult>;
};
export {};
