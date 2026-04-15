// PRIMITIVE: think
//
// The agent's inner voice. Calls the LLM and returns thoughts and tool calls.
// Re-exports from the LLM client to keep all primitives in one place.

export {
  think,
  type Message,
  type ThinkResult,
  type ToolCall,
  type ToolDefinition,
  type ThinkEvent,
  type ThinkEventSink,
} from "../llm/client.js";
