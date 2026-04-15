export type WebSearchArgs = {
    query: string;
    count?: number;
    country?: string;
    search_lang?: string;
    ui_lang?: string;
    freshness?: string;
};
export type WebSearchResultItem = {
    title: string;
    url: string;
    description: string;
    published?: string;
    siteName?: string;
};
export type WebSearchResult = {
    ok: true;
    query: string;
    provider: "brave";
    count: number;
    tookMs: number;
    results: WebSearchResultItem[];
    cached?: boolean;
} | {
    ok: false;
    error: string;
    message: string;
};
export declare function webSearch(args: WebSearchArgs): Promise<WebSearchResult>;
