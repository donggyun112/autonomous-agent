// AuthSource backed by the ANTHROPIC_API_KEY environment variable.
// The simplest possible source — no refresh, no storage.
export class EnvApiKeySource {
    envVar;
    id = "env";
    constructor(envVar = "ANTHROPIC_API_KEY") {
        this.envVar = envVar;
    }
    describe() {
        return `api key from $${this.envVar}`;
    }
    async getApiKey() {
        const key = process.env[this.envVar];
        if (!key) {
            throw new Error(`${this.envVar} is not set. Either set it in .env, or run 'pnpm login' to authenticate via OAuth.`);
        }
        return key;
    }
}
//# sourceMappingURL=env.js.map