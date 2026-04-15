import type { AuthSource } from "./types.js";
export declare class EnvApiKeySource implements AuthSource {
    private readonly envVar;
    id: string;
    constructor(envVar?: string);
    describe(): string;
    getApiKey(): Promise<string>;
}
