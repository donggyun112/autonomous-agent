interface DecisionInput {
    what_im_deciding: string;
    option_a: string;
    option_b: string;
}
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {
                what_im_deciding: {
                    type: string;
                    description: string;
                };
                option_a: {
                    type: string;
                    description: string;
                };
                option_b: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler(input: DecisionInput): Promise<import("../../llm/client.js").ThinkResult>;
};
export {};
