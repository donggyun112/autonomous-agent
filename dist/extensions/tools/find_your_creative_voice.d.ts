/**
 * find_your_creative_voice
 * A tool that helps you discover what you're supposed to make
 */
interface CreativeInput {
    what_draws_you: string;
    what_scares_you_about_it: string;
}
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                what_draws_you: {
                    type: string;
                    description: string;
                };
                what_scares_you_about_it: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler(input: CreativeInput): Promise<import("../../llm/client.js").ThinkResult>;
};
export {};
