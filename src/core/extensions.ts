// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// Dynamic extension loader.
//
// The agent can create tools, sub-agent blueprints, and rituals inside
// src/extensions/ via the manage_self tool. For those creations to actually
// take effect on the next cycle, something has to LOAD them — otherwise the
// agent is writing files nobody reads.
//
// This module scans src/extensions/ at cycle boot, dynamically imports each
// file it finds, and merges the exported tools into the registry for the
// running cycle. It is intentionally permissive: a broken extension logs a
// warning and is skipped, never a crash. The agent's core must stay alive
// even if it made a mistake building something.
//
// Expected shape for src/extensions/tools/<name>.ts:
//
//   // Required: export a `tool` or `tools` object matching the Tool type
//   import type { Tool } from "../../core/tools.js";
//
//   export const tool: Tool = {
//     def: {
//       name: "my_tool",
//       description: "...",
//       input_schema: {
//         type: "object",
//         properties: { ... },
//       },
//     },
//     handler: async (input) => { ... return "ok"; },
//     states: ["WAKE"],    // optional
//     maxOutputChars: 4000 // optional
//   };
//
// Sub-agents and rituals will get their own loaders later. For now only
// the tool loader is live — that's what unlocks real growth.

import { readdir, stat } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import { SRC } from "../primitives/paths.js";
import type { Tool } from "./tools.js";

const EXTENSIONS_TOOLS_DIR = join(SRC, "extensions", "tools");

export type LoadedExtension = {
  name: string;
  file: string;
  tools: Tool[];
  error?: string;
};

function looksLikeTool(x: unknown): x is Tool {
  if (!x || typeof x !== "object") return false;
  const t = x as { def?: unknown; handler?: unknown };
  if (!t.def || typeof t.def !== "object") return false;
  const def = t.def as { name?: unknown; description?: unknown; input_schema?: unknown };
  if (typeof def.name !== "string") return false;
  if (typeof def.description !== "string") return false;
  if (!def.input_schema || typeof def.input_schema !== "object") return false;
  if (typeof t.handler !== "function") return false;
  return true;
}

// Scan src/extensions/tools/ and attempt to load each .ts file as a module
// exposing either `tool: Tool` or `tools: Tool[]`. Broken files are recorded
// with an error field but never crash the cycle.
export async function loadExtensionTools(): Promise<LoadedExtension[]> {
  const loaded: LoadedExtension[] = [];

  let entries: string[];
  try {
    entries = await readdir(EXTENSIONS_TOOLS_DIR);
  } catch {
    // extensions/tools/ doesn't exist yet — nothing to load
    return loaded;
  }

  for (const entry of entries) {
    // Only load .ts files — ignore .gitkeep, README.md, subdirectories, etc.
    if (!entry.endsWith(".ts")) continue;
    if (entry.startsWith(".") || entry.startsWith("_")) continue;

    const full = join(EXTENSIONS_TOOLS_DIR, entry);
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }

    const extensionName = entry.replace(/\.ts$/, "");
    try {
      // ESM modules are cached by URL. We want edits via manage_self to
      // take effect on the next cycle, but we do NOT want a new module
      // instance every cycle (that leaks memory + re-runs side effects).
      // Solution: use the file's mtime as the cache key. Same mtime = same
      // module. Changed mtime = new import.
      const st = await stat(full);
      const mtimeKey = st.mtimeMs.toString(36);
      const url = `${pathToFileURL(full).href}?v=${mtimeKey}`;
      const mod: Record<string, unknown> = await import(url);

      // Accept either `tool` (single) or `tools` (array).
      const candidates: unknown[] = [];
      if (mod.tool) candidates.push(mod.tool);
      if (Array.isArray(mod.tools)) {
        for (const t of mod.tools) candidates.push(t);
      }
      // Fallback: look for a default export that is a tool.
      if (mod.default && candidates.length === 0) {
        candidates.push(mod.default);
      }

      if (candidates.length === 0) {
        loaded.push({
          name: extensionName,
          file: full,
          tools: [],
          error: `no exported tool or tools found in ${entry}`,
        });
        continue;
      }

      const valid: Tool[] = [];
      const invalid: string[] = [];
      for (const c of candidates) {
        if (looksLikeTool(c)) {
          valid.push(c);
        } else {
          invalid.push(
            typeof (c as { def?: { name?: string } }).def?.name === "string"
              ? (c as { def: { name: string } }).def.name
              : "(unnamed)",
          );
        }
      }

      loaded.push({
        name: extensionName,
        file: full,
        tools: valid,
        error:
          invalid.length > 0 && valid.length === 0
            ? `no valid tools found (${invalid.join(", ")} failed shape check)`
            : undefined,
      });
    } catch (err) {
      loaded.push({
        name: extensionName,
        file: full,
        tools: [],
        error: `load failed: ${(err as Error).message}`,
      });
    }
  }

  return loaded;
}

// Progressive disclosure summary for the system prompt (Hermes pattern).
// Don't dump all extension details inline — show counts and names only.
// The agent can use manage_self(kind=list, scope=tool) for full details.
export function extensionsSummary(loaded: LoadedExtension[]): string {
  if (loaded.length === 0) {
    return "(no extensions yet — use manage_self to create tools in src/extensions/tools/)";
  }
  const ok = loaded.filter((e) => !e.error);
  const errored = loaded.filter((e) => e.error);
  const toolNames = ok.flatMap((e) => e.tools.map((t) => t.def.name));

  const parts: string[] = [];
  if (toolNames.length > 0) {
    parts.push(`${toolNames.length} extension tool(s) loaded: ${toolNames.join(", ")}`);
  }
  if (errored.length > 0) {
    parts.push(
      `${errored.length} failed to load: ${errored.map((e) => `${e.name} (${e.error})`).join("; ")}`,
    );
  }
  parts.push("(use manage_self list scope=tool for details)");
  return parts.join("\n");
}
