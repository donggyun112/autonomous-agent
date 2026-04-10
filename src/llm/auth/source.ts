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

let _source: AuthSource | null = null;

export async function getAuthSource(): Promise<AuthSource> {
  if (_source) return _source;

  const mode = (process.env.AGENT_AUTH ?? "auto").toLowerCase();

  if (mode === "api_key" || mode === "apikey") {
    _source = new EnvApiKeySource();
    return _source;
  }

  if (mode === "oauth") {
    _source = new AnthropicOAuthSource();
    return _source;
  }

  if (mode === "auto") {
    if (process.env.ANTHROPIC_API_KEY) {
      _source = new EnvApiKeySource();
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
