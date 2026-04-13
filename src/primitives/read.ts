// PRIMITIVE: read
//
// The agent may read any file inside its own src/ or data/.
// It may not read outside its own world.

import { readFile, readdir, stat } from "fs/promises";
import { resolve, relative } from "path";
import { ROOT } from "./paths.js";

function isInside(target: string): boolean {
  const rel = relative(ROOT, target);
  return !rel.startsWith("..") && !resolve(rel).startsWith("..");
}

// Paths the agent must never read (secrets, credentials).
const BLOCKED_PATTERNS = [".auth", ".env", "oauth.json", "credentials"];

function isBlocked(path: string): boolean {
  const lower = path.toLowerCase();
  return BLOCKED_PATTERNS.some((p) => lower.includes(p));
}

export async function readPath(path: string): Promise<string> {
  const abs = resolve(ROOT, path);
  if (!isInside(abs)) {
    throw new Error(
      `read: path is outside of self (${path}). The agent may only read its own world.`,
    );
  }
  if (isBlocked(path)) {
    throw new Error(`read: access denied — ${path} contains sensitive data.`);
  }
  const s = await stat(abs);
  if (s.isDirectory()) {
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .map((e) => `${e.isDirectory() ? "[d]" : "   "} ${e.name}`)
      .join("\n");
  }
  return await readFile(abs, "utf-8");
}

export async function listDir(path: string): Promise<string[]> {
  const abs = resolve(ROOT, path);
  if (!isInside(abs)) {
    throw new Error(`list: path is outside of self (${path}).`);
  }
  return await readdir(abs);
}
