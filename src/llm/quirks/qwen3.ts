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

/** Extract balanced braces substring starting at pos (handles nesting + quoted strings) */
function extractBalancedBraces(src: string, pos: number): string | null {
  if (src[pos] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = pos; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"' && !esc) { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(pos, i + 1); }
  }
  return null;
}

/** Try to parse JSON leniently — fix common Qwen quirks like missing } or ) instead of } */
function lenientJsonParse(raw: string): Record<string, unknown> | null {
  // Try as-is first
  try { return JSON.parse(raw); } catch { /* continue */ }
  // Try adding missing }
  try { return JSON.parse(raw + "}"); } catch { /* continue */ }
  // Try replacing trailing ) with }
  const fixed = raw.replace(/\)\s*$/, "}");
  try { return JSON.parse(fixed); } catch { /* continue */ }
  // Try stripping everything after the last ] and adding }
  const lastBracket = raw.lastIndexOf("]");
  if (lastBracket > 0) {
    try { return JSON.parse(raw.slice(0, lastBracket + 1) + "}"); } catch { /* continue */ }
  }
  return null;
}

/** Parse [calling tool: name({...})] or [Calling Tool: name({...})] format */
function extractBracketCalls(source: string): Array<{ name: string; input: Record<string, unknown> }> {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const headerPattern = /\[(?:calling tool|Calling Tool|Calling tool|CALLING TOOL):\s*(\w+)\(/gi;
  let m;
  while ((m = headerPattern.exec(source)) !== null) {
    const braceStart = m.index + m[0].length;
    // Try balanced braces first
    let jsonStr = extractBalancedBraces(source, braceStart);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr.replace(/'/g, '"'));
        calls.push({ name: m[1], input: parsed });
        continue;
      } catch { /* try lenient */ }
    }
    // Fallback: extract from { to the closing )] or ]) and parse leniently
    if (source[braceStart] === "{") {
      const endMatch = source.slice(braceStart).search(/\)\s*\]|\]\s*\)/);
      if (endMatch > 0) {
        const raw = source.slice(braceStart, braceStart + endMatch).replace(/'/g, '"');
        const parsed = lenientJsonParse(raw);
        if (parsed) {
          calls.push({ name: m[1], input: parsed });
        }
      }
    }
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
