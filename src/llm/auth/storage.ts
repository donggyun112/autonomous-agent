// Persistent storage for OAuth credentials.
//
// Lives in data/.auth/oauth.json — inside the agent's body. Mode 0600 so
// only the owning user can read.

import { chmod, mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DATA } from "../../primitives/paths.js";
import type { OAuthCredentials } from "./types.js";

const AUTH_DIR = join(DATA, ".auth");
const OAUTH_FILE = join(AUTH_DIR, "oauth.json");

type StoredCredentials = {
  anthropic?: OAuthCredentials;
};

export async function loadCredentials(): Promise<StoredCredentials> {
  try {
    const text = await readFile(OAUTH_FILE, "utf-8");
    return JSON.parse(text) as StoredCredentials;
  } catch {
    return {};
  }
}

export async function saveAnthropicCredentials(creds: OAuthCredentials): Promise<void> {
  const existing = await loadCredentials();
  const updated: StoredCredentials = { ...existing, anthropic: creds };
  await mkdir(dirname(OAUTH_FILE), { recursive: true });
  await writeFile(OAUTH_FILE, JSON.stringify(updated, null, 2), "utf-8");
  try {
    await chmod(OAUTH_FILE, 0o600);
  } catch {
    // chmod may fail on some filesystems — not critical
  }
}

export async function clearAnthropicCredentials(): Promise<void> {
  try {
    const existing = await loadCredentials();
    delete existing.anthropic;
    if (Object.keys(existing).length === 0) {
      await unlink(OAUTH_FILE);
    } else {
      await writeFile(OAUTH_FILE, JSON.stringify(existing, null, 2), "utf-8");
    }
  } catch {
    // ok
  }
}

export function credentialsFilePath(): string {
  return OAUTH_FILE;
}
