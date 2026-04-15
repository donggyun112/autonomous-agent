/**
 * what_if_you_were_wrong
 * A tool for people who are too sure they're right
 */
interface WrongInput {
    what_im_sure_about: string;
}
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                what_im_sure_about: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler(input: WrongInput): Promise<import("../../llm/client.js").ThinkResult>;
};
export {};
