// Unified LLM adapter parameterized by transport.
//
// Replaces both PiAdapter (Anthropic/OpenAI) and LocalAdapter.
// Delegates API calls to a transport, then applies quirks if needed.

import type { LlmAdapter } from "../adapter.js";
import type { ThinkOnceArgs, ThinkResult, SamplingParams } from "../types.js";
import type { LlmTransport } from "../transports/types.js";
import { getModelMeta } from "../models.js";
import { applyQuirks } from "../quirks/index.js";

export interface SdkAdapterConfig {
  id: string;
  transport: LlmTransport;
  getApiKey: () => Promise<string>;
  baseUrl?: string;
  rotateCredentialFn?: () => Promise<boolean>;
  defaultSampling?: SamplingParams;
}

export class SdkAdapter implements LlmAdapter {
  readonly id: string;
  private transport: LlmTransport;
  private config: SdkAdapterConfig;

  constructor(config: SdkAdapterConfig) {
    this.id = config.id;
    this.transport = config.transport;
    this.config = config;
  }

  async thinkOnce(args: ThinkOnceArgs): Promise<ThinkResult> {
    const apiKey = await this.config.getApiKey();
    const meta = getModelMeta(args.model ?? "default");

    const result = await this.transport.call({
      model: args.model ?? "default",
      systemPrompt: args.systemPrompt,
      messages: args.messages,
      tools: args.tools,
      maxTokens: args.maxTokens ?? 4096,
      sampling: this.config.defaultSampling,
      onEvent: args.onEvent,
      config: {
        baseUrl: this.config.baseUrl ?? "",
        apiKey,
        ...(args.tools ? {} : {}),
      },
    });

    // Apply quirks if transport found no tool calls.
    // Pass reasoning too — Qwen puts tool calls inside <think> blocks.
    if (result.toolCalls.length === 0 && meta.quirks?.length) {
      const quirked = applyQuirks(meta.quirks, result.text, result.reasoning);
      if (quirked.toolCalls.length > 0) {
        result.toolCalls = quirked.toolCalls;
        result.text = quirked.cleanedText;
        result.stopReason = "tool_use";
      }
    }

    return result;
  }

  async rotateCredential(): Promise<boolean> {
    return this.config.rotateCredentialFn?.() ?? false;
  }
}
