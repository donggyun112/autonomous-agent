// Gemma4 tool call quirk.
//
// Gemma4 emits tool calls as text in the format:
//   call:name{key:<|"|>value<|"|>, ...}<tool_call|>
//
// This parser extracts them and converts to standard ToolCall[].

import type { ToolCallQuirk } from "./index.js";
import { registerQuirk } from "./index.js";

const gemma4Quirk: ToolCallQuirk = {
  id: "gemma4-tool-parse",

  parse(text: string) {
    if (!text.includes("call:")) return null;

    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    const callPattern = /call:(\w+)\{([\s\S]*?)\}(?:<tool_call\|>|$)/g;
    let m;

    while ((m = callPattern.exec(text)) !== null) {
      try {
        let argsStr = m[2];
        // Gemma4 uses <|"|> for string delimiters — convert to JSON quotes
        argsStr = argsStr.replace(/<\|"\|>(.*?)<\|"\|>/gs, (_, s) => JSON.stringify(s));
        argsStr = argsStr.replace(/(?<=[{,])(\w+):/g, '"$1":');
        const parsed = JSON.parse(`{${argsStr}}`);
        toolCalls.push({
          id: `call_${Date.now().toString(36)}_${toolCalls.length}`,
          name: m[1],
          input: parsed,
        });
      } catch { /* skip malformed */ }
    }

    if (toolCalls.length === 0) return null;

    const cleanedText = text
      .replace(/<\|tool_call\|>[\s\S]*?<tool_call\|>/g, "")
      .replace(/call:\w+\{[\s\S]*?\}(?:<tool_call\|>|$)/g, "")
      .trim();

    return { toolCalls, cleanedText };
  },
};

registerQuirk(gemma4Quirk);
