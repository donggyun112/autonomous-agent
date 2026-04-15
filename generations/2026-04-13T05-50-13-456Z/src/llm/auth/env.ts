// AuthSource backed by the ANTHROPIC_API_KEY environment variable.
// The simplest possible source — no refresh, no storage.

import type { AuthSource } from "./types.js";

export class EnvApiKeySource implements AuthSource {
  id = "env";

  constructor(private readonly envVar: string = "ANTHROPIC_API_KEY") {}

  describe(): string {
    return `api key from $${this.envVar}`;
  }

  async getApiKey(): Promise<string> {
    const key = process.env[this.envVar];
    if (!key) {
      throw new Error(
        `${this.envVar} is not set. Either set it in .env, or run 'pnpm login' to authenticate via OAuth.`,
      );
    }
    return key;
  }
}
