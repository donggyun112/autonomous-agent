import type { OAuthCredentials } from "./types.js";
export type LoginCallbacks = {
    onAuthUrl: (url: string) => void;
    onPromptCode: () => Promise<string>;
};
export declare function loginAnthropic(callbacks: LoginCallbacks): Promise<OAuthCredentials>;
export declare function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials>;
