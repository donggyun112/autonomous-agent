import type { OAuthCredentials } from "./types.js";
type StoredCredentials = {
    anthropic?: OAuthCredentials;
    openai?: OAuthCredentials & {
        idToken?: string;
    };
};
export type { StoredCredentials };
export declare function loadCredentials(): Promise<StoredCredentials>;
export declare function saveAnthropicCredentials(creds: OAuthCredentials): Promise<void>;
export declare function saveOpenAICredentials(creds: OAuthCredentials & {
    idToken?: string;
}): Promise<void>;
export declare function clearAnthropicCredentials(): Promise<void>;
export declare function credentialsFilePath(): string;
