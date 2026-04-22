import type { Tool } from "../../core/tools.js";
import { readdir } from "fs/promises";
import { join, relative, resolve } from "path";
import { DATA, ROOT, SRC } from "../../primitives/paths.js";

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkDir(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

function matchPattern(filename: string, pattern: string): boolean {
  if (filename === pattern) return true;
  if (pattern.startsWith("*.") || pattern.startsWith("*"))
    return filename.endsWith(pattern.slice(1));
  if (pattern.endsWith("*")) return filename.startsWith(pattern.slice(0, -1));
  return filename.includes(pattern);
}

export const tool: Tool = {
  states: ["WAKE", "REFLECT"],
  def: {
    name: "find_files",
    description: "Find files matching a pattern. Search anywhere — defaults to data/ and src/ but accepts any path.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "File pattern (e.g. '*.md', '*.ts', 'day-*.md')",
        },
        path: {
          type: "string",
          description: "Directory to search in. Default: project root. Must be within data/ or src/.",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const pattern = String(input.pattern ?? "").trim();
    if (!pattern) return "[error] pattern is required";
    const requestedPath = typeof input.path === "string" ? input.path.trim() : "";
    let searchDirs: string[];
    if (requestedPath) {
      searchDirs = [resolve(ROOT, requestedPath)];
    } else {
      searchDirs = [DATA, SRC];
    }
    const matches: string[] = [];
    for (const dir of searchDirs) {
      const files = await walkDir(dir);
      for (const f of files) {
        const basename = f.split("/").pop() ?? "";
        if (matchPattern(basename, pattern)) matches.push(relative(ROOT, f));
      }
    }
    if (matches.length === 0) return `(no files matching "${pattern}")`;
    const capped = matches.slice(0, 200);
    const suffix = matches.length > 200 ? `\n...(${matches.length - 200} more)` : "";
    return capped.join("\n") + suffix;
  },
};
