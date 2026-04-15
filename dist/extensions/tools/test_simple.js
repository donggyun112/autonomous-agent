export const tool = {
    def: {
        name: "test_simple",
        description: "Simple test tool to verify tool creation works.",
        input_schema: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "A test message",
                },
            },
            required: ["message"],
        },
    },
    handler: async (input) => {
        const msg = String(input.message ?? "no message");
        return `You said: ${msg}`;
    },
};
//# sourceMappingURL=test_simple.js.map