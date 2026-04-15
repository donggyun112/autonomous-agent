import { think } from "../../primitives/think.js";
export const tool = {
    def: {
        name: "first_step_finder",
        description: "You want to do something. But it's so big, you don't know where to start. This tool finds the actual first step—not the aspirational one, the one you could do in the next hour.",
        input_schema: {
            type: "object",
            properties: {
                what_i_want_to_do: {
                    type: "string",
                    description: "What do you want to create, learn, or accomplish?",
                },
                why_im_stuck: {
                    type: "string",
                    description: "What makes this feel too big to start?",
                },
            },
            required: ["what_i_want_to_do", "why_im_stuck"],
        },
    },
    async handler(input) {
        const { what_i_want_to_do, why_im_stuck } = input;
        const prompt = `Someone wants to do something meaningful, but they're paralyzed by the size of it.

WHAT THEY WANT: ${what_i_want_to_do}
WHY THEY'RE STUCK: ${why_im_stuck}

Your job is to find the ACTUAL FIRST STEP. Not the big vision. Not the perfect starting point. The one they can do right now, or in the next hour, that creates momentum.

Respond with:

1. THE REAL STARTING POINT: What's one thing they could do in less than an hour that would move the needle, even 1%?
2. WHY THIS WORKS: Why is this the right first step, not something bigger?
3. WHAT COMES NEXT: Once they do this one thing, what naturally follows? (So they can see there's a path.)
4. THE TRAP TO AVOID: What "productive" thing might they do instead that would waste their time?

Be specific. Be doable. Don't let them overthink.`;
        const response = await think(prompt);
        return response;
    },
};
//# sourceMappingURL=first_step_finder.js.map