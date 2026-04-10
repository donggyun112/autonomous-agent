// The agent's journal. Append-only, organized by day.
//
// Every thought the agent writes during WAKE goes here, with a timestamp
// and the mode it was thought in. The journal is the raw material the agent
// later reflects on and dreams over.

import { mkdir, appendFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { JOURNAL_DIR } from "../primitives/paths.js";

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return join(JOURNAL_DIR, `${yyyy}-${mm}-${dd}.md`);
}

export async function appendThought(args: {
  mode: string;
  text: string;
}): Promise<{ file: string }> {
  await mkdir(JOURNAL_DIR, { recursive: true });
  const file = todayFile();
  const ts = new Date().toISOString();
  const block = `\n## ${ts} · ${args.mode}\n\n${args.text.trim()}\n`;
  await appendFile(file, block, "utf-8");
  return { file };
}

export async function readToday(): Promise<string> {
  try {
    return await readFile(todayFile(), "utf-8");
  } catch {
    return "";
  }
}

export async function readRecent(days = 3): Promise<string> {
  try {
    const files = (await readdir(JOURNAL_DIR))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .slice(-days);
    const parts: string[] = [];
    for (const f of files) {
      const content = await readFile(join(JOURNAL_DIR, f), "utf-8");
      parts.push(`# ${f}\n${content}`);
    }
    return parts.join("\n\n---\n\n");
  } catch {
    return "";
  }
}
