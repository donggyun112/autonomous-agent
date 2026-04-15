// Dead-letter queue — failed tool calls queued for retry.
import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";

const DLQ_FILE = join(DATA, "dead-letter.jsonl");

export type FailedEntry = {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  error: string;
  ts: string;
};

export async function enqueueFailed(entry: Omit<FailedEntry, "id">): Promise<void> {
  await mkdir(DATA, { recursive: true });
  const full: FailedEntry = { ...entry, id: `dlq-${Date.now().toString(36)}` };
  await appendFile(DLQ_FILE, JSON.stringify(full) + "\n", "utf-8");
}

export async function peekDeadLetter(limit = 10): Promise<FailedEntry[]> {
  try {
    const text = await readFile(DLQ_FILE, "utf-8");
    return text.split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) as FailedEntry; } catch { return null; } })
      .filter((e): e is FailedEntry => e !== null)
      .slice(-limit);
  } catch { return []; }
}

export async function clearDeadLetterEntry(id: string): Promise<boolean> {
  try {
    const text = await readFile(DLQ_FILE, "utf-8");
    const lines = text.split("\n").filter((l) => l.trim());
    const filtered = lines.filter((l) => {
      try { return (JSON.parse(l) as FailedEntry).id !== id; } catch { return true; }
    });
    if (filtered.length === lines.length) return false;
    // Atomic write via temp file + rename to avoid losing concurrent appends.
    const tmp = DLQ_FILE + ".tmp";
    await writeFile(tmp, filtered.join("\n") + "\n", "utf-8");
    const { rename } = await import("fs/promises");
    await rename(tmp, DLQ_FILE);
    return true;
  } catch { return false; }
}
