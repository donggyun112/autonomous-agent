// PRIMITIVE: write
//
// The agent may write to:
//   - data/        : the body. Always allowed. The agent records itself.
//   - src/extensions/ : light molt. The agent extends itself with new tools, sub-agents, rituals.
//   - generations/ : full molt staging. New shell candidates live here until verified.
//
// The agent may NOT directly overwrite files in src/core, src/states, src/primitives, src/llm.
// To change those, the agent must build a new shell in generations/ and pass it through the molt ritual.
//
// data/ is sacred. The body is never deleted by the shell. Only appended/updated.

import { writeFile, mkdir, appendFile } from "fs/promises";
import { resolve, relative, dirname } from "path";
import { ROOT, DATA, SRC, GENERATIONS } from "./paths.js";

const PROTECTED_SUBDIRS = ["core", "states", "primitives", "llm"];

function checkWritable(target: string): void {
  const abs = resolve(ROOT, target);
  const rel = relative(ROOT, abs);

  if (rel.startsWith("..")) {
    throw new Error(`write: path escapes self (${target}).`);
  }

  // data/ — always allowed
  if (abs.startsWith(DATA)) return;

  // generations/ — molt staging area, allowed
  if (abs.startsWith(GENERATIONS)) return;

  // src/extensions/ — light molt, allowed
  if (abs.startsWith(resolve(SRC, "extensions"))) return;

  // src/* — check if it falls under a protected subdir
  if (abs.startsWith(SRC)) {
    const sub = relative(SRC, abs).split("/")[0];
    if (PROTECTED_SUBDIRS.includes(sub)) {
      throw new Error(
        `write: path is in protected shell core (${rel}). Use the molt ritual via generations/ instead.`,
      );
    }
    // src/ root files (like a new dir not in protected list) — allowed
    return;
  }

  throw new Error(`write: path is outside writable areas (${rel}).`);
}

export async function writePath(path: string, content: string): Promise<void> {
  const abs = resolve(ROOT, path);
  checkWritable(abs);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
}

export async function appendPath(path: string, content: string): Promise<void> {
  const abs = resolve(ROOT, path);
  checkWritable(abs);
  await mkdir(dirname(abs), { recursive: true });
  await appendFile(abs, content, "utf-8");
}
