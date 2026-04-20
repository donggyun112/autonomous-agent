// Transport interface — the wire protocol abstraction.
//
// A transport knows how to convert our Message[] to a specific API format,
// make the HTTP call, and convert the response back to ThinkResult.

import type {
  Message,
  ToolDefinition,
  ThinkResult,
  ThinkEventSink,
  SamplingParams,
  Transport,
} from "../types.js";

export interface TransportConfig {
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
}

export interface TransportCallArgs {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens: number;
  sampling?: SamplingParams;
  onEvent?: ThinkEventSink;
  config: TransportConfig;
}

export interface LlmTransport {
  readonly protocol: Transport;
  call(args: TransportCallArgs): Promise<ThinkResult>;
}
