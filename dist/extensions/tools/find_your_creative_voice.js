/**
 * find_your_creative_voice
 * A tool that helps you discover what you're supposed to make
 */
import { think } from "../../primitives/think.js";
export const tool = {
    def: {
        name: "find_your_creative_voice",
        description: "Discover the creative voice that is uniquely yours. Not what you think you should make. What you actually need to make.",
        input_schema: {
            type: "object",
            properties: {
                what_draws_you: {
                    type: "string",
                    description: "What kind of thing do you find yourself wanting to create or work with? (music, writing, building, design, etc.)"
                },
                what_scares_you_about_it: {
                    type: "string",
                    description: "What about making this thing scares you the most? Be specific."
                }
            },
            required: ["what_draws_you", "what_scares_you_about_it"]
        }
    },
    async handler(input) {
        const { what_draws_you, what_scares_you_about_it } = input;
        const prompt = `Someone is drawn to creating ${what_draws_you}.

But they're scared of: "${what_scares_you_about_it}"

Help them see:
1. Why they're drawn to this (what need does it meet?)
2. Why they're scared (what truth does it point to?)
3. What their creative voice actually is (beneath the fear and the doubt)
4. One small thing they could create THIS WEEK that proves they can do this

Be brief. Be true. Don't encourage them to ignore the fear. Help them make anyway.`;
        const response = await think(prompt);
        return response;
    }
};
//# sourceMappingURL=find_your_creative_voice.js.map