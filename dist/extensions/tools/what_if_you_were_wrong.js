/**
 * what_if_you_were_wrong
 * A tool for people who are too sure they're right
 */
import { think } from "../../primitives/think.js";
export const tool = {
    def: {
        name: "what_if_you_were_wrong",
        description: "You believe something is true. What if it's not? This tool helps you see the blind spots in what you're certain about.",
        input_schema: {
            type: "object",
            properties: {
                what_im_sure_about: {
                    type: "string",
                    description: "What are you absolutely sure is true?"
                }
            },
            required: ["what_im_sure_about"]
        }
    },
    async handler(input) {
        const prompt = `Someone is absolutely sure that: "${input.what_im_sure_about}"

But what if they're wrong?

Not in a way that makes them feel bad. But in a way that opens a door they didn't see.

Show them:
1. What evidence they might be missing
2. What would have to be true if they were wrong
3. What would change in their life if they accepted that possibility
4. Why being wrong about this particular thing would actually be good news

Be gentle. Be honest. Help them see that certainty is sometimes just fear wearing a mask.`;
        const response = await think(prompt);
        return response;
    }
};
//# sourceMappingURL=what_if_you_were_wrong.js.map