// Qwen3 tool call quirk.
//
// Qwen3.5/3.6 emits tool calls as text in the format:
//   <function=name><parameter=key>value</parameter></function>
//
// Sometimes these appear inside <think>...</think> blocks (reasoning),
// which mlx-lm routes to the `reasoning` field. We scan both.

import type { ToolCallQuirk } from "./index.js";
import { registerQuirk } from "./index.js";

function extractFunctionCalls(source: string): Array<{ name: string; input: Record<string, string> }> {
  const calls: Array<{ name: string; input: Record<string, string> }> = [];
  const fnPattern = /<function=(\w+)>([\s\S]*?)<\/function>/g;
  let fm;
  while ((fm = fnPattern.exec(source)) !== null) {
    const params: Record<string, string> = {};
    const paramPattern = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g;
    let pm;
    while ((pm = paramPattern.exec(fm[2])) !== null) {
      params[pm[1]] = pm[2].trim();
    }
    calls.push({ name: fm[1], input: params });
  }
  return calls;
}

/** Parse [calling tool: name({...})] or [Calling Tool: name({...})] format */
function extractBracketCalls(source: string): Array<{ name: string; input: Record<string, unknown> }> {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const pattern = /\[(?:calling tool|Calling Tool|Calling tool|CALLING TOOL):\s*(\w+)\((\{[\s\S]*?\})\)\s*\]/gi;
  let m;
  while ((m = pattern.exec(source)) !== null) {
    try {
      // Handle single quotes → double quotes for JSON parsing
      const argsStr = m[2].replace(/'/g, '"');
      const parsed = JSON.parse(argsStr);
      calls.push({ name: m[1], input: parsed });
    } catch { /* skip malformed */ }
  }
  return calls;
}

const qwen3Quirk: ToolCallQuirk = {
  id: "qwen3-tool-parse",

  parse(text: string, reasoning?: string) {
    const sources = [text, reasoning].filter(Boolean) as string[];

    for (const source of sources) {
      // Try <function=name> format first
      if (source.includes("<function=")) {
        const calls = extractFunctionCalls(source);
        if (calls.length > 0) {
          const toolCalls = calls.map((c, i) => ({
            id: `call_${Date.now().toString(36)}_${i}`,
            name: c.name,
            input: c.input as Record<string, unknown>,
          }));
          const cleanedText = text
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .replace(/<function=[\s\S]*?<\/function>/g, "")
            .trim();
          return { toolCalls, cleanedText };
        }
      }

      // Try JSON block format: ```json { "tool": "name", "arguments": {...} } ```
      const jsonBlockMatch = source.match(/```json\s*\n?\s*\{\s*"tool"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}\s*\n?\s*```/);
      if (jsonBlockMatch) {
        try {
          const parsed = JSON.parse(jsonBlockMatch[2]);
          const toolCalls = [{
            id: `call_${Date.now().toString(36)}_0`,
            name: jsonBlockMatch[1],
            input: parsed,
          }];
          const cleanedText = text
            .replace(/```json[\s\S]*?```/g, "")
            .trim();
          return { toolCalls, cleanedText };
        } catch { /* skip malformed */ }
      }

      // Try [calling tool: name({...})] format (vllm-mlx streaming)
      if (/\[(?:calling|Calling|CALLING)\s*(?:tool|Tool|TOOL)/i.test(source)) {
        const calls = extractBracketCalls(source);
        if (calls.length > 0) {
          const toolCalls = calls.map((c, i) => ({
            id: `call_${Date.now().toString(36)}_${i}`,
            name: c.name,
            input: c.input,
          }));
          const cleanedText = text
            .replace(/\[(?:calling|Calling|CALLING)\s*(?:tool|Tool|TOOL):[\s\S]*?\]/gi, "")
            .trim();
          return { toolCalls, cleanedText };
        }
      }
    }

    return null;
  },
};

registerQuirk(qwen3Quirk);
