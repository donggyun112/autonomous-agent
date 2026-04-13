// Factory for picking the right AuthSource at runtime.
//
// Controlled by the AGENT_AUTH environment variable:
//   AGENT_AUTH=api_key  — use $ANTHROPIC_API_KEY, fail if missing
//   AGENT_AUTH=oauth    — use OAuth credentials from data/.auth/oauth.json, fail if missing
//   AGENT_AUTH=auto     — prefer api_key if set, else fall back to oauth
//   (unset)             — same as auto
//
// The factory is cached so concurrent getApiKey() calls share the same
// in-memory refresh lock.

import { EnvApiKeySource } from "./env.js";
import { AnthropicOAuthSource } from "./oauth.js";
import { loadCredentials } from "./storage.js";
import type { AuthSource } from "./types.js";

// Multi-key AuthSource that supports rotating through ANTHROPIC_API_KEY,
// ANTHROPIC_API_KEY_2, ANTHROPIC_API_KEY_3 when a key gets 401/403.
//
// The primary key is always tried first. When rotateCredential() is called,
// the current key is moved to the back of the list and the next one becomes
// active. If all keys have been exhausted, rotateCredential() returns false.
class MultiKeySource implements AuthSource {
  id = "multi-env";
  private keys: string[];
  private currentIndex = 0;
  private exhaustedKeys = new Set<number>();

  constructor() {
    const envVars = ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_2", "ANTHROPIC_API_KEY_3"];
    this.keys = envVars
      .map((v) => process.env[v])
      .filter((k): k is string => !!k && k.length > 0);

    if (this.keys.length === 0) {
      throw new Error(
        "No API keys available. Set ANTHROPIC_API_KEY (and optionally _2, _3) in .env.",
      );
    }
  }

  describe(): string {
    return `multi-key (${this.keys.length} key${this.keys.length > 1 ? "s" : ""}, active index ${this.currentIndex})`;
  }

  async getApiKey(): Promise<string> {
    return this.keys[this.currentIndex]!;
  }

  // Rotate to the next available key. Returns true if a new key was
  // activated, false if all keys are exhausted.
  async rotateCredential(): Promise<boolean> {
    this.exhaustedKeys.add(this.currentIndex);

    for (let i = 0; i < this.keys.length; i++) {
      if (!this.exhaustedKeys.has(i)) {
        this.currentIndex = i;
        return true;
      }
    }
    return false;
  }
}

let _source: AuthSource | null = null;

export async function getAuthSource(): Promise<AuthSource> {
  if (_source) return _source;

  const mode = (process.env.AGENT_AUTH ?? "auto").toLowerCase();

  if (mode === "api_key" || mode === "apikey") {
    // Use multi-key source when explicit api_key mode is requested.
    _source = new MultiKeySource();
    return _source;
  }

  if (mode === "oauth") {
    _source = new AnthropicOAuthSource();
    return _source;
  }

  if (mode === "auto") {
    if (process.env.ANTHROPIC_API_KEY) {
      _source = new MultiKeySource();
      return _source;
    }
    // Check if OAuth credentials exist on disk
    const creds = await loadCredentials();
    if (creds.anthropic) {
      _source = new AnthropicOAuthSource();
      return _source;
    }
    throw new Error(
      "No auth available. Either set ANTHROPIC_API_KEY or run 'pnpm login' to authenticate via OAuth.",
    );
  }

  throw new Error(`Unknown AGENT_AUTH mode: ${mode}. Use api_key, oauth, or auto.`);
}

// Force-reset the cached source. Used after login/logout CLI commands so the
// next request picks up the new state.
export function resetAuthSource(): void {
  _source = null;
}
