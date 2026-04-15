// Mock LLM adapter for self-test (molt verification).
//
// When SELF_TEST_MOCK_LLM=1, think() routes here instead of touching
// the network. Returns a scripted response that triggers transition to
// SLEEP, exercising the full cycle machinery without burning tokens.

import type { LlmAdapter } from "../adapter.js";
import type { ThinkOnceArgs, ThinkResult } from "../types.js";

export class MockAdapter implements LlmAdapter {
  readonly id = "mock";

  async thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult> {
    const result: ThinkResult = {
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

  async rotateCredential(): Promise<boolean> {
    return false;
  }
}
