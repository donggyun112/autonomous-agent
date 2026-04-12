// Session store — persists the LLM message history to disk.
//
// Every message (assistant response, tool result, user opening) is appended
// to data/session.jsonl as it happens. On restart, messages are reloaded
// so the agent continues where it left off.
//
// SLEEP clears the session file — sleep is the natural session boundary.
// Compact replaces the file with the compacted messages.

import { appendFile, mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DATA } from "../primitives/paths.js";
import type { Message } from "../llm/client.js";

const SESSION_FILE = join(DATA, "session.jsonl");

export async function appendMessage(message: Message): Promise<void> {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await appendFile(SESSION_FILE, JSON.stringify(message) + "\n", "utf-8");
}

export async function loadSession(): Promise<Message[]> {
  try {
    const text = await readFile(SESSION_FILE, "utf-8");
    const messages: Message[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line) as Message);
      } catch {
        // skip malformed lines
      }
    }
    return messages;
  } catch {
    return [];
  }
}

// Replace the session file with a new set of messages (after compact).
export async function replaceSession(messages: Message[]): Promise<void> {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  const lines = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  await writeFile(SESSION_FILE, lines, "utf-8");
}

// Clear session — called when entering SLEEP (natural boundary).
export async function clearSession(): Promise<void> {
  try {
    await rm(SESSION_FILE);
  } catch {
    // ok — file may not exist
  }
}
