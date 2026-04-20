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

const qwen3Quirk: ToolCallQuirk = {
  id: "qwen3-tool-parse",

  parse(text: string, reasoning?: string) {
    // Scan both text and reasoning (Qwen sometimes puts tool calls in thinking)
    const sources = [text, reasoning].filter(Boolean) as string[];

    for (const source of sources) {
      if (!source.includes("<function=")) continue;
      const calls = extractFunctionCalls(source);
      if (calls.length === 0) continue;

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

    return null;
  },
};

registerQuirk(qwen3Quirk);
