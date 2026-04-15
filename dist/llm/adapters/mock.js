// Mock LLM adapter for self-test (molt verification).
//
// When SELF_TEST_MOCK_LLM=1, think() routes here instead of touching
// the network. Returns a scripted response that triggers transition to
// SLEEP, exercising the full cycle machinery without burning tokens.
export class MockAdapter {
    id = "mock";
    async thinkOnce(args) {
        const result = {
            text: "(mock self-test thought — the shell is alive)",
            toolCalls: [
                {
                    id: "mock_t1",
                    name: "transition",
                    input: { to: "SLEEP", reason: "self-test complete" },
                },
            ],
            stopReason: "tool_use",
            inputTokens: 0,
            outputTokens: 0,
        };
        if (args.onEvent) {
            args.onEvent({ type: "text_delta", delta: result.text });
            args.onEvent({ type: "message_end", result });
        }
        return result;
    }
    async rotateCredential() {
        return false;
    }
}
//# sourceMappingURL=mock.js.map