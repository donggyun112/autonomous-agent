// Auth abstraction for the LLM client.
//
// The client does not care whether its API key comes from an env var, a
// credentials file with an OAuth refresh token, or something else — it just
// asks its AuthSource for a key before each request.
//
// Concrete sources live in ./env.ts, ./oauth.ts, etc.

export type OAuthCredentials = {
  access: string;   // access token
  refresh: string;  // refresh token (OAuth only)
  expires: number;  // epoch ms after which the access token is invalid
};

export interface AuthSource {
  // Short id for logs / debugging / selection.
  id: string;
  // Human-readable description.
  describe(): string;
  // Return a fresh API key, refreshing if necessary. Safe to call concurrently.
  getApiKey(): Promise<string>;
}
