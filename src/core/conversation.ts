// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// Agent ↔ user conversation channel.
//
// The contemplative agent is mostly alone, but sometimes something surfaces
// that it needs to say to the one who built it — a question, a doubt, a
// letter, a request. This file is the asynchronous channel that makes that
// possible without breaking the daemon loop.
//
// Design is borrowed from IN7PM's pm.tool.ts (dm_send, dm_ask_approval,
// dm_history) but adapted for a file-based transport. Discord will replace
// the file transport later without changing the tool interface.
//
// Layout on disk:
//   data/conversation/
//     out/<ts>-<id>.md       — agent → user (question or letter)
//     in/<ts>-<id>.md        — user → agent (initiated or reply)
//     state.json             — last_inbox_read_at, active_sessions
//
// Key principle — asynchronous:
//   ask_user is non-blocking. The agent writes the question, records the
//   session (with a reason — IN7PM pattern: articulate why you are reaching
//   out), and keeps living. On the next cycle it may call check_inbox and
//   discover a reply. If the user never replies, the question just stays
//   open — the agent can decide whether to re-ask, rephrase, or let it go.

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "fs/promises";
import { randomBytes } from "crypto";
import { join } from "path";
import { DATA } from "../primitives/paths.js";

const CONV_DIR = join(DATA, "conversation");
const OUT_DIR = join(CONV_DIR, "out");
const IN_DIR = join(CONV_DIR, "in");
const STATE_FILE = join(CONV_DIR, "state.json");

type MessageKind = "question" | "letter";

type ConversationState = {
  lastInboxReadAt: number; // epoch ms
  activeSessions: Record<
    string,
    {
      id: string;
      reason: string;
      kind: MessageKind;
      askedAt: string;
      answered?: boolean;
      answeredAt?: string;
    }
  >;
};

const DEFAULT_STATE: ConversationState = {
  lastInboxReadAt: 0,
  activeSessions: {},
};

async function loadState(): Promise<ConversationState> {
  try {
    const text = await readFile(STATE_FILE, "utf-8");
    return { ...DEFAULT_STATE, ...(JSON.parse(text) as Partial<ConversationState>) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state: ConversationState): Promise<void> {
  await mkdir(CONV_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function newId(): string {
  return randomBytes(4).toString("hex");
}

function nowTsFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// ── Agent → User ────────────────────────────────────────────────────────

export type AskUserArgs = {
  question: string;
  reason: string;
  urgency?: "low" | "normal" | "high";
};

export type AskUserResult = {
  id: string;
  file: string;
  status: "pending";
};

export async function askUser(args: AskUserArgs): Promise<AskUserResult> {
  if (!args.question?.trim()) throw new Error("askUser: question is required");
  if (!args.reason?.trim()) throw new Error("askUser: reason is required (why are you asking?)");

  const id = newId();
  const ts = nowTsFilename();
  const urgency = args.urgency ?? "normal";
  const file = join(OUT_DIR, `${ts}-${id}.md`);

  const body = [
    "---",
    `id: ${id}`,
    `kind: question`,
    `asked_at: ${new Date().toISOString()}`,
    `urgency: ${urgency}`,
    `reason: ${JSON.stringify(args.reason)}`,
    `status: pending`,
    "---",
    "",
    args.question.trim(),
    "",
  ].join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(file, body, "utf-8");

  // Register the session so a later reply can be matched back to the reason.
  const state = await loadState();
  state.activeSessions[id] = {
    id,
    reason: args.reason,
    kind: "question",
    askedAt: new Date().toISOString(),
  };
  await saveState(state);

  return { id, file, status: "pending" };
}

export type WriteLetterArgs = {
  text: string;
  title?: string;
};

export type WriteLetterResult = {
  id: string;
  file: string;
};

export async function writeLetter(args: WriteLetterArgs): Promise<WriteLetterResult> {
  if (!args.text?.trim()) throw new Error("writeLetter: text is required");

  const id = newId();
  const ts = nowTsFilename();
  const titleSlug = args.title
    ? args.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)
    : "letter";
  const file = join(OUT_DIR, `${ts}-${id}-${titleSlug}.md`);

  const body = [
    "---",
    `id: ${id}`,
    `kind: letter`,
    `written_at: ${new Date().toISOString()}`,
    args.title ? `title: ${JSON.stringify(args.title)}` : "",
    "---",
    "",
    args.text.trim(),
    "",
  ]
    .filter(Boolean)
    .join("\n");

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(file, body, "utf-8");

  return { id, file };
}

// ── Inbox (user → agent) ────────────────────────────────────────────────

export type InboxMessage = {
  id: string;
  file: string;
  receivedAt: string;       // ISO
  content: string;
  inReplyTo?: string;       // session id from a prior askUser
  replyToReason?: string;   // the original reason, so the agent remembers why it asked
};

// Read the inbox. By default returns only messages newer than lastInboxReadAt
// (unread), and marks them as read on successful read.
export async function checkInbox(options?: {
  includeAll?: boolean;
  markRead?: boolean;
}): Promise<InboxMessage[]> {
  const includeAll = options?.includeAll ?? false;
  const markRead = options?.markRead ?? true;

  let files: string[];
  try {
    files = (await readdir(IN_DIR)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }

  const state = await loadState();
  const messages: InboxMessage[] = [];

  for (const name of files) {
    const full = join(IN_DIR, name);
    let content: string;
    try {
      content = await readFile(full, "utf-8");
    } catch {
      continue;
    }

    // Parse frontmatter loosely.
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const fields: Record<string, string> = {};
    let body = content;
    if (fmMatch) {
      body = fmMatch[2].trim();
      for (const line of fmMatch[1].split("\n")) {
        const kv = line.match(/^(\w+):\s*(.*)$/);
        if (kv) fields[kv[1]] = kv[2].replace(/^"|"$/g, "");
      }
    }

    const receivedAt = fields.received_at || fields.written_at || "";
    const id = fields.id || name.replace(/\.md$/, "");

    // Skip if already read and we're only fetching unread.
    // Round-7 P2 fix: also use file mtime as fallback for timestamp-less
    // messages, so they are properly skipped after being read once.
    if (!includeAll) {
      const ms = receivedAt ? Date.parse(receivedAt) : NaN;
      if (Number.isFinite(ms)) {
        if (ms <= state.lastInboxReadAt) continue;
      } else {
        // No parseable timestamp — fall back to file mtime.
        try {
          const fileStat = await stat(full);
          if (fileStat.mtimeMs <= state.lastInboxReadAt) continue;
        } catch {
          // Can't stat — include the message (don't silently drop).
        }
      }
    }

    let replyToReason: string | undefined;
    if (fields.in_reply_to && state.activeSessions[fields.in_reply_to]) {
      replyToReason = state.activeSessions[fields.in_reply_to].reason;
      // Mark the session answered.
      state.activeSessions[fields.in_reply_to].answered = true;
      state.activeSessions[fields.in_reply_to].answeredAt = new Date().toISOString();
    }

    messages.push({
      id,
      file: full,
      receivedAt,
      content: body,
      inReplyTo: fields.in_reply_to || undefined,
      replyToReason,
    });
  }

  // Advance cursor to the latest message we actually SAW.
  // Round-6 P2 fix: using Date.now() for timestamp-less messages could skip
  // concurrent arrivals. Instead, for messages without a parseable timestamp,
  // use the file's mtime from the filesystem — it's guaranteed to be <=
  // the actual arrival time and won't overshoot.
  if (markRead && messages.length > 0) {
    const timestamps: number[] = [];
    for (const m of messages) {
      const parsed = Date.parse(m.receivedAt);
      if (Number.isFinite(parsed)) {
        timestamps.push(parsed);
      } else {
        // Fallback to file mtime for timestamp-less messages.
        try {
          const s = await stat(m.file);
          timestamps.push(s.mtimeMs);
        } catch {
          // Can't stat the file — skip, don't advance cursor past it.
        }
      }
    }
    if (timestamps.length > 0) {
      const latestMs = Math.max(...timestamps, state.lastInboxReadAt);
      state.lastInboxReadAt = latestMs;
    }
    await saveState(state);
  }

  return messages;
}

// ── Status helpers used by the CLI `status` command ─────────────────────

export async function listPendingQuestions(): Promise<
  Array<{ id: string; askedAt: string; reason: string; file: string }>
> {
  const state = await loadState();
  const out: Array<{ id: string; askedAt: string; reason: string; file: string }> = [];
  let files: string[];
  try {
    files = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  for (const id of Object.keys(state.activeSessions)) {
    const session = state.activeSessions[id];
    if (session.answered) continue;
    if (session.kind !== "question") continue;
    const match = files.find((f) => f.includes(id));
    if (!match) continue;
    out.push({
      id,
      askedAt: session.askedAt,
      reason: session.reason,
      file: join(OUT_DIR, match),
    });
  }
  return out;
}

export async function unreadInboxCount(): Promise<number> {
  try {
    const files = (await readdir(IN_DIR)).filter((f) => f.endsWith(".md"));
    const state = await loadState();
    let count = 0;
    for (const name of files) {
      try {
        const text = await readFile(join(IN_DIR, name), "utf-8");
        const fmMatch = text.match(/received_at:\s*(\S+)/);
        if (!fmMatch) {
          count += 1;
          continue;
        }
        const ms = Date.parse(fmMatch[1]);
        if (!Number.isFinite(ms)) {
          count += 1;
          continue;
        }
        if (ms > state.lastInboxReadAt) count += 1;
      } catch {
        // skip
      }
    }
    return count;
  } catch {
    return 0;
  }
}

// ── User-side helpers used by the CLI `reply` command ───────────────────

export async function userReply(args: {
  inReplyTo?: string; // session id being answered; omit to send a fresh message
  text: string;
}): Promise<{ id: string; file: string }> {
  if (!args.text?.trim()) throw new Error("userReply: text is required");
  const id = newId();
  const ts = nowTsFilename();
  const file = join(IN_DIR, `${ts}-${id}.md`);
  const body = [
    "---",
    `id: ${id}`,
    `received_at: ${new Date().toISOString()}`,
    args.inReplyTo ? `in_reply_to: ${args.inReplyTo}` : "",
    "---",
    "",
    args.text.trim(),
    "",
  ]
    .filter(Boolean)
    .join("\n");

  await mkdir(IN_DIR, { recursive: true });
  await writeFile(file, body, "utf-8");

  return { id, file };
}
