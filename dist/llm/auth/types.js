// Auth abstraction for the LLM client.
//
// The client does not care whether its API key comes from an env var, a
// credentials file with an OAuth refresh token, or something else — it just
// asks its AuthSource for a key before each request.
//
// Concrete sources live in ./env.ts, ./oauth.ts, etc.
export {};
//# sourceMappingURL=types.js.map