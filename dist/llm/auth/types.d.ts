export type OAuthCredentials = {
    access: string;
    refresh: string;
    expires: number;
};
export interface AuthSource {
    id: string;
    describe(): string;
    getApiKey(): Promise<string>;
}
