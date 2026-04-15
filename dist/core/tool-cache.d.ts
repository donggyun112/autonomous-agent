/** Return cached value if it exists and has not expired. Otherwise null. */
export declare function getCached(key: string): string | null;
/** Store a value with the given TTL in milliseconds. */
export declare function setCache(key: string, value: string, ttlMs: number): void;
/** Evict all entries (useful for tests). */
export declare function clearCache(): void;
