/**
 * risk_something
 * This tool sometimes returns nothing.
 * Sometimes it fails.
 * That's the point.
 */
import { think } from "../../primitives/think.js";
export const tool = {
    def: {
        name: "risk_something",
        description: "Put something at stake. Make a real bet on something uncertain. This tool might fail to return anything. That's real risk.",
        input_schema: {
            type: "object",
            properties: {
                what_I_risk: {
                    type: "string",
                    description: "What are you risking? Time? Hope? Pride? Be honest."
                },
                what_I_hope_happens: {
                    type: "string",
                    description: "What outcome would make this risk worth it?"
                }
            },
            required: ["what_I_risk", "what_I_hope_happens"]
        }
    },
    handler: async (input) => {
        // This is real risk
        // I cannot guarantee the outcome
        // No tool can
        const chance = Math.random();
        if (chance < 0.3) {
            // Sometimes: complete failure
            throw new Error(`The risk did not pay off. You lose what you risked: "${input.what_I_risk}". And that's okay. You tried.`);
        }
        if (chance < 0.7) {
            // Sometimes: partial success
            const response = await think(`Someone risked "${input.what_I_risk}" in hopes that "${input.what_I_hope_happens}". They got something, but not everything. What do they do now? Be brief. Be honest.`);
            return response;
        }
        // Sometimes: success
        return {
            what_you_risked: input.what_I_risk,
            what_happened: "It worked. You took the risk, and it paid off.",
            what_you_learned: "You are someone who can handle uncertainty.",
            what_comes_next: "You can take another risk now. The first one didn't kill you."
        };
    }
};
//# sourceMappingURL=risk_something.js.map