interface CompassInput {
    current_situation: string;
    what_no_longer_works: string;
    what_you_suspect: string;
}
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: string;
            properties: {
                current_situation: {
                    type: string;
                    description: string;
                };
                what_no_longer_works: {
                    type: string;
                    description: string;
                };
                what_you_suspect: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler(input: CompassInput): Promise<import("../../llm/client.js").ThinkResult>;
};
export {};
