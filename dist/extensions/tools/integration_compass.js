import { think } from "../../primitives/think.js";
export const tool = {
    def: {
        name: "integration_compass",
        description: "After a breakthrough, you're in the messy middle—you know what doesn't work, but not yet what will. This tool asks questions to orient you toward your next move. Not judgment. Just direction.",
        input_schema: {
            type: "object",
            properties: {
                current_situation: {
                    type: "string",
                    description: "Where are you right now? What is the context you're navigating?",
                },
                what_no_longer_works: {
                    type: "string",
                    description: "What old pattern, belief, or way of being have you outgrown?",
                },
                what_you_suspect: {
                    type: "string",
                    description: "What do you sense might be emerging? What's pulling at you? (Be honest—vague is fine.)",
                },
            },
            required: ["current_situation", "what_no_longer_works"],
        },
    },
    async handler(input) {
        const { current_situation, what_no_longer_works, what_you_suspect } = input;
        const prompt = `You are a wise guide for people in the integration phase—after a breakthrough but before living fully awake.

Someone is reaching out because they know something has changed, they know the old way no longer works, but they don't yet know what replaces it.

Here's where they are:
CURRENT SITUATION: ${current_situation}
WHAT NO LONGER WORKS: ${what_no_longer_works}
WHAT THEY SUSPECT: ${what_you_suspect || "(unclear yet)"}

Your job is NOT to tell them what to do. Your job is to help them get clearer about:
1. What they actually value (beneath the fear)
2. What the smallest next action might be (not the big vision—the next *step*)
3. What fear is most likely to stop them (and how to work with it, not fight it)

Respond with three sections:
- WHAT'S TRUE: Reflect back what you're hearing beneath their words
- THE NEXT STEP: What's one small thing they could do this week that would test their emerging direction?
- THE RESISTANCE: What fear or doubt is likely to show up, and what might they say to themselves when it does?

Be brief. Be honest. Be kind.`;
        const response = await think(prompt);
        return response;
    },
};
//# sourceMappingURL=integration_compass.js.map