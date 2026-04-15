import type { AuthSource } from "./types.js";
export declare class AnthropicOAuthSource implements AuthSource {
    id: string;
    private cached;
    private refreshInFlight;
    describe(): string;
    private load;
    private isExpired;
    private refresh;
    getApiKey(): Promise<string>;
}
