import type { Key, Memory } from "./types.js";
export declare function sanitizeKeys(keys: unknown): string[];
export declare class MemoryGraph {
    keys: Record<string, Key>;
    memories: Record<string, Memory>;
    private _keyToMems;
    private _memToKeys;
    private _supersededBy;
    private _storedDim;
    private _lock;
    private _dirty;
    static readonly HOP_DECAY = 0.5;
    static readonly TIME_HALF_LIFE: number;
    get linkCount(): number;
    private _link;
    private _hasLink;
    private _unlinkMemory;
    private _pruneOrphanKeys;
    private _checkDim;
    private _isExpired;
    private _timeFactor;
    private _keyIdf;
    private _findDuplicate;
    private _autoLinkKeys;
    getKeysForMemory(memId: string): string[];
    load(): Promise<void>;
    save(): Promise<void>;
    markDirty(): void;
    flush(): Promise<void>;
    findOrCreateKey(concept: string, keyType?: "concept" | "name" | "proper_noun"): Promise<string>;
    add(content: string, keyConcepts: string[], options?: {
        keyTypes?: Record<string, string> | null;
        source?: Record<string, unknown> | null;
        namespace?: string;
        ttlSeconds?: number | null;
        relatedTo?: string[] | null;
    }): Promise<[string, boolean]>;
    supersede(oldId: string, newContent: string, options?: {
        keyConcepts?: string[] | null;
        keyTypes?: Record<string, string> | null;
        source?: Record<string, unknown> | null;
        namespace?: string | null;
        relatedTo?: string[] | null;
    }): Promise<string>;
    recall(query: string, topK?: number, namespace?: string | null, expand?: boolean): Promise<object[]>;
    getRelated(memoryId: string): object[];
    delete(memoryId: string): Promise<boolean>;
    listAll(namespace?: string | null): object[];
    cleanupExpired(): Promise<number>;
    dream(args: {
        memoryId: string;
        compressedContent: string;
        depthIncrement?: number;
    }): Promise<{
        id: string;
        depth: number;
        previousContent: string;
    }>;
    listRecent(limit?: number): {
        id: string;
        content: string;
        depth: number;
        created_at: number;
        access_count: number;
    }[];
    listShallow(maxDepth?: number, limit?: number): {
        id: string;
        content: string;
        depth: number;
        created_at: number;
    }[];
    pruneWeak(options?: {
        minAgeSec?: number;
        maxToPrune?: number;
    }): Promise<string[]>;
    findClusters(options?: {
        minSharedKeys?: number;
        minClusterSize?: number;
        maxClusters?: number;
    }): {
        keys: string[];
        memoryIds: string[];
        contents: string[];
    }[];
    pickRandomDistantPair(): {
        a: {
            id: string;
            content: string;
        };
        b: {
            id: string;
            content: string;
        };
    } | null;
    link(memA: string, memB: string, viaKey: string): Promise<void>;
    stats(): {
        keyCount: number;
        memoryCount: number;
        activeMemoryCount: number;
        linkCount: number;
        avgDepth: number;
        avgContentLen: number;
    };
}
export declare function saveTurn(sessionId: string, role: string, content: string): Promise<number>;
export declare function loadConversation(sessionId: string, turn?: number | null): Promise<object[]>;
