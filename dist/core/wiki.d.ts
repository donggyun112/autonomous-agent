export type WikiKind = "concept" | "entity" | "self" | "meta";
export type WikiPageFrontmatter = {
    slug: string;
    kind: WikiKind;
    title: string;
    created_at: string;
    updated_at: string;
    sources?: string[];
    related?: string[];
    reason?: string;
    confidence?: number;
};
export type WikiPage = {
    frontmatter: WikiPageFrontmatter;
    body: string;
    path: string;
};
export declare function slugify(title: string): string;
export declare function readPage(kind: WikiKind, slug: string): Promise<WikiPage | null>;
export declare function writePage(args: {
    kind: WikiKind;
    slug: string;
    title: string;
    body: string;
    sources?: string[];
    related?: string[];
    reason?: string;
    /** #12: If true, increment confidence (used by sleep consolidation). */
    sleepConsolidation?: boolean;
}): Promise<{
    created: boolean;
    path: string;
    warning?: string;
}>;
export type WikiPageSummary = {
    slug: string;
    kind: WikiKind;
    title: string;
    updated_at: string;
    path: string;
};
export declare function listPages(options?: {
    kind?: WikiKind;
}): Promise<WikiPageSummary[]>;
export declare function rebuildIndex(): Promise<{
    count: number;
    path: string;
}>;
export type LintFinding = {
    kind: "orphan" | "stale" | "broken-link" | "lonely" | "contradiction";
    slug: string;
    pageKind: WikiKind;
    detail: string;
};
export type LintReport = {
    totalPages: number;
    findings: LintFinding[];
    summary: string;
};
export declare function lintWiki(options?: {
    staleDays?: number;
    includeContradictions?: boolean;
}): Promise<LintReport>;
export type WikiRepairReport = {
    totalPages: number;
    pagesTouched: number;
    relatedNormalized: number;
    sourcesBackfilled: number;
};
export declare function repairWiki(options?: {
    backfillSources?: boolean;
    sleepConsolidation?: boolean;
}): Promise<WikiRepairReport>;
export declare function appendLog(args: {
    ts: string;
    kind: "create" | "update" | "lint" | "delete";
    target: string;
    note?: string;
}): Promise<void>;
export declare function ensureWikiInitialized(): Promise<void>;
