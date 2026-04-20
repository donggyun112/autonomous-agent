// Quirk system — pluggable model-specific tool call parsers.
//
// Some local models emit tool calls as text instead of structured tool_calls.
// Each quirk knows how to parse one format. They are applied as a chain
// after the transport returns — if the transport found no tool calls,
// quirks get a chance to extract them from the text/reasoning.

import type { ToolCall } from "../types.js";

export interface ToolCallQuirk {
  id: string;
  /** Try to extract tool calls from text/reasoning. Returns null if no match. */
  parse(text: string, reasoning?: string): {
    toolCalls: ToolCall[];
    cleanedText: string;
  } | null;
}

const quirks = new Map<string, ToolCallQuirk>();

export function registerQuirk(q: ToolCallQuirk): void {
  quirks.set(q.id, q);
}

export function getQuirk(id: string): ToolCallQuirk | undefined {
  return quirks.get(id);
}

/** Apply a chain of quirks. First match wins. */
export function applyQuirks(
  quirkIds: string[],
  text: string,
  reasoning?: string,
): { toolCalls: ToolCall[]; cleanedText: string } {
  for (const id of quirkIds) {
    const q = quirks.get(id);
    if (!q) continue;
    const result = q.parse(text, reasoning);
    if (result && result.toolCalls.length > 0) return result;
  }
  return { toolCalls: [], cleanedText: text };
}
