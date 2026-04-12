// Sub-agent loader.
//
// The agent can create "inner voices" — sub-agents defined as markdown
// files in src/extensions/subagents/. Each has a frontmatter personality
// and a body of instructions. When the agent calls `summon(name)`, the
// sub-agent's instructions become a fresh LLM call's system prompt, and
// the sub-agent's response is returned as a tool result.
//
// Sub-agents share the body (data/) read-only. They cannot call tools
// or modify state — they can only think and respond. They are voices
// within the self, not independent actors.
//
// Expected format for src/extensions/subagents/<name>.md:
//
//   ---
//   name: questioner
//   description: Asks hard questions about what the agent just wrote
//   ---
//
//   You are the Questioner — a voice inside the agent's mind that
//   challenges assumptions and asks uncomfortable questions...

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { SRC } from "../primitives/paths.js";
import { think } from "../llm/client.js";

const SUBAGENTS_DIR = join(SRC, "extensions", "subagents");

export type SubAgentDef = {
  name: string;
  description: string;
  systemPrompt: string;
  file: string;
};

function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^"|"$/g, "");
  }
  return { fields, body: match[2].trim() };
}

export async function listSubAgents(): Promise<SubAgentDef[]> {
  const defs: SubAgentDef[] = [];
  let entries: string[];
  try {
    entries = await readdir(SUBAGENTS_DIR);
  } catch {
    return defs;
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    if (name.startsWith(".") || name === "README.md") continue;
    const full = join(SUBAGENTS_DIR, name);
    try {
      const s = await stat(full);
      if (!s.isFile()) continue;
      const text = await readFile(full, "utf-8");
      const { fields, body } = parseFrontmatter(text);
      if (!fields.name || !body) continue;
      defs.push({
        name: fields.name,
        description: fields.description ?? "",
        systemPrompt: body,
        file: full,
      });
    } catch {
      // skip broken files
    }
  }
  return defs;
}

export async function summonSubAgent(args: {
  name: string;
  message: string;
  contextFromParent?: string;
}): Promise<{ response: string; subAgentName: string }> {
  const all = await listSubAgents();
  const def = all.find((d) => d.name === args.name);
  if (!def) {
    return {
      response: `[error] sub-agent "${args.name}" not found. Available: ${all.map((d) => d.name).join(", ") || "(none)"}`,
      subAgentName: args.name,
    };
  }

  // The sub-agent gets: its own system prompt + optional parent context + the message.
  const systemPrompt = [
    def.systemPrompt,
    args.contextFromParent
      ? `\n---\n\n## context from the agent who summoned you\n\n${args.contextFromParent}`
      : "",
  ].join("");

  const result = await think({
    systemPrompt,
    messages: [{ role: "user", content: args.message }],
    maxTokens: 2048,
  });

  return {
    response: result.text.trim(),
    subAgentName: def.name,
  };
}
