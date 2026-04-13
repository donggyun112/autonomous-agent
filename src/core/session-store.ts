// Session store — persists the LLM message history to disk.
//
// Every message (assistant response, tool result, user opening) is appended
// to data/session.jsonl as it happens. On restart, messages are reloaded
// so the agent continues where it left off.
//
// SLEEP clears the session file — sleep is the natural session boundary.
// Compact replaces the file with the compacted messages.

import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DATA } from "../primitives/paths.js";
import type { Message } from "../llm/client.js";

const SESSION_ARCHIVE_DIR = join(DATA, "session-archive");

const SESSION_FILE = join(DATA, "session.jsonl");
const SESSION_META_FILE = join(DATA, "session-meta.json");

// ── Session continuity metadata ─────────────────────────────────────────

export type SessionMeta = {
  startedAt: string;
  mode: string;
  turnCount: number;
  lastCompactedAt?: string;
};

async function loadSessionMeta(): Promise<SessionMeta | null> {
  try {
    const text = await readFile(SESSION_META_FILE, "utf-8");
    return JSON.parse(text) as SessionMeta;
  } catch {
    return null;
  }
}

async function saveSessionMeta(meta: SessionMeta): Promise<void> {
  await mkdir(dirname(SESSION_META_FILE), { recursive: true });
  await writeFile(SESSION_META_FILE, JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

export async function getSessionMeta(): Promise<SessionMeta | null> {
  return loadSessionMeta();
}

export async function initSessionMeta(mode: string): Promise<void> {
  const existing = await loadSessionMeta();
  if (existing) return; // already initialized for this session
  await saveSessionMeta({
    startedAt: new Date().toISOString(),
    mode,
    turnCount: 0,
  });
}

export async function incrementSessionTurn(): Promise<void> {
  const meta = await loadSessionMeta();
  if (!meta) return;
  meta.turnCount += 1;
  await saveSessionMeta(meta);
}

export async function markSessionCompacted(): Promise<void> {
  const meta = await loadSessionMeta();
  if (!meta) return;
  meta.lastCompactedAt = new Date().toISOString();
  await saveSessionMeta(meta);
}

async function clearSessionMeta(): Promise<void> {
  try {
    await rm(SESSION_META_FILE);
  } catch {
    // ok — file may not exist
  }
}

export async function appendMessage(message: Message): Promise<void> {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await appendFile(SESSION_FILE, JSON.stringify(message) + "\n", "utf-8");
  try {
    await incrementSessionTurn();
  } catch {
    // meta tracking failure should not block the session
  }
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
// Also marks session meta as compacted.
export async function replaceSession(messages: Message[]): Promise<void> {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  const lines = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  await writeFile(SESSION_FILE, lines, "utf-8");
  try {
    await markSessionCompacted();
  } catch {
    // meta tracking failure should not block compaction
  }
}

// Archive the current session to data/session-archive/ before clearing.
// Returns true if the archive succeeded (or there was nothing to archive).
// Returns false if the archive failed — caller should NOT delete the original.
async function archiveSession(): Promise<boolean> {
  try {
    const stats = await stat(SESSION_FILE);
    if (stats.size === 0) return true; // nothing to archive

    await mkdir(SESSION_ARCHIVE_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/:/g, "-");
    const archivePath = join(SESSION_ARCHIVE_DIR, `${ts}.jsonl`);
    await copyFile(SESSION_FILE, archivePath);
    return true;
  } catch {
    // Session file may not exist (nothing to archive = ok).
    try {
      await stat(SESSION_FILE);
      return false; // file exists but archive failed — don't delete original
    } catch {
      return true; // file doesn't exist — nothing to lose
    }
  }
}

// Clear session — called when entering SLEEP (natural boundary).
// Archives the session before deleting. If archive fails, we still clear
// the session to prevent stale pre-sleep context from leaking into next WAKE.
// Data loss in that case is acceptable — the journal has the real thoughts,
// and the session is just a conversation cache.
export async function clearSession(): Promise<void> {
  await archiveSession(); // best-effort archive
  try {
    await rm(SESSION_FILE);
  } catch {
    // ok — file may not exist
  }
  await clearSessionMeta();
}

// Search across archived sessions for a text query. Returns matching files
// with a short preview of the first matching line.
export async function searchSessions(
  query: string,
): Promise<Array<{ file: string; preview: string }>> {
  const results: Array<{ file: string; preview: string }> = [];
  if (!query.trim()) return results;

  const lowerQuery = query.toLowerCase();

  try {
    const files = await readdir(SESSION_ARCHIVE_DIR);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort().reverse();

    for (const file of jsonlFiles) {
      try {
        const content = await readFile(join(SESSION_ARCHIVE_DIR, file), "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          if (line.toLowerCase().includes(lowerQuery)) {
            // Extract a short preview from the matching line.
            const idx = line.toLowerCase().indexOf(lowerQuery);
            const start = Math.max(0, idx - 60);
            const end = Math.min(line.length, idx + query.length + 60);
            const preview =
              (start > 0 ? "..." : "") +
              line.slice(start, end) +
              (end < line.length ? "..." : "");
            results.push({ file, preview });
            break; // one match per file is enough for search results
          }
        }
      } catch {
        // skip unreadable files
      }

      // Cap results to avoid blowing up on large archives.
      if (results.length >= 20) break;
    }
  } catch {
    // archive directory may not exist yet
  }

  return results;
}
