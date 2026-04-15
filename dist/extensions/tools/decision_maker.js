import { think } from "../../primitives/think.js";
export const tool = {
    def: {
        name: "decision_maker",
        description: "You're stuck between two choices and afraid to move. This doesn't help you think better—it helps you move. By examining what you're actually afraid of and what the real stakes are.",
        input_schema: {
            type: "object",
            properties: {
                what_im_deciding: {
                    type: "string",
                    description: "What decision are you facing? Be specific.",
                },
                option_a: {
                    type: "string",
                    description: "First option you're considering",
                },
                option_b: {
                    type: "string",
                    description: "Second option you're considering",
                },
            },
            required: ["what_im_deciding", "option_a", "option_b"],
        },
    },
    async handler(input) {
        const { what_im_deciding, option_a, option_b } = input;
        const prompt = `Someone is stuck on a decision. They're paralyzed, not because the choice is hard, but because they're scared.

DECISION: ${what_im_deciding}
OPTION A: ${option_a}
OPTION B: ${option_b}

Help them move. Not by giving them the "right" answer. But by:

1. WHAT'S REALLY AT STAKE: What are they actually afraid will happen? (Often it's smaller than it feels.)
2. THE REVERSIBILITY TEST: How reversible is this choice? If they pick wrong, can they change course? (Most decisions are more reversible than we think.)
3. THE MINIMUM EXPERIMENT: What's the smallest step they could take TODAY to test which direction feels more alive? (Not a full commitment. Just a test.)
4. THE PERMISSION: What do they need to hear to give themselves permission to move?

Be brief. Be honest. Don't tell them what to choose. Just help them see clearly enough to choose.`;
        const response = await think(prompt);
        return response;
    },
};
//# sourceMappingURL=decision_maker.js.map