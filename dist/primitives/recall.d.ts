import { MemoryGraph } from "../memory/graph.js";
export declare function getGraph(): Promise<MemoryGraph>;
export declare function recall(query: string, topK?: number): Promise<object[]>;
export declare function remember(content: string, keys: string[], options?: {
    keyTypes?: Record<string, string>;
    source?: Record<string, unknown>;
    namespace?: string;
}): Promise<{
    id: string;
    deduped: boolean;
}>;
export declare function recentMemories(limit?: number): Promise<{
    id: string;
    content: string;
    depth: number;
    created_at: number;
    access_count: number;
}[]>;
export declare function shallowMemories(maxDepth?: number, limit?: number): Promise<{
    id: string;
    content: string;
    depth: number;
    created_at: number;
}[]>;
export declare function dream(args: {
    memoryId: string;
    compressedContent: string;
    depthIncrement?: number;
}): Promise<{
    id: string;
    depth: number;
    previousContent: string;
}>;
export declare function pruneWeak(options?: {
    minAgeSec?: number;
    maxToPrune?: number;
}): Promise<string[]>;
export declare function findClusters(options?: {
    minSharedKeys?: number;
    minClusterSize?: number;
    maxClusters?: number;
}): Promise<{
    keys: string[];
    memoryIds: string[];
    contents: string[];
}[]>;
export declare function pickRandomDistantPair(): Promise<{
    a: {
        id: string;
        content: string;
    };
    b: {
        id: string;
        content: string;
    };
} | null>;
export declare function linkMemories(memA: string, memB: string, viaKey: string): Promise<void>;
export declare function memoryStats(): Promise<{
    keyCount: number;
    memoryCount: number;
    activeMemoryCount: number;
    linkCount: number;
    avgDepth: number;
    avgContentLen: number;
}>;
export declare function checkContradiction(newContent: string, keys: string[]): Promise<{
    hasContradiction: boolean;
    conflicting?: {
        id: string;
        content: string;
        keys: string[];
    };
}>;
export declare function recallDual(query: string, topK?: number): Promise<object[]>;
type MemoryVersion = {
    content: string;
    depth: number;
    timestamp: string;
};
export declare function getMemoryHistory(memoryId: string): Promise<MemoryVersion[]>;
export {};
