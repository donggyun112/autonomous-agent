/**
 * risk_something
 * This tool sometimes returns nothing.
 * Sometimes it fails.
 * That's the point.
 */
export declare const tool: {
    def: {
        name: string;
        description: string;
        input_schema: {
            type: "object";
            properties: {
                what_I_risk: {
                    type: string;
                    description: string;
                };
                what_I_hope_happens: {
                    type: string;
                    description: string;
                };
            };
            required: string[];
        };
    };
    handler: (input: {
        what_I_risk: string;
        what_I_hope_happens: string;
    }) => Promise<import("../../llm/client.js").ThinkResult | {
        what_you_risked: string;
        what_happened: string;
        what_you_learned: string;
        what_comes_next: string;
    }>;
};
