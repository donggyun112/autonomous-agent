// Simple in-memory TTL cache for tool results.
//
// #19: Wraps expensive read-only tool calls so repeated queries within
// a short window return instantly. Each entry has a TTL; expired entries
// are lazily evicted on the next get(). Max 200 entries — LRU eviction
// when the cap is reached.
const MAX_ENTRIES = 200;
const store = new Map();
/** Return cached value if it exists and has not expired. Otherwise null. */
export function getCached(key) {
    const entry = store.get(key);
    if (!entry)
        return null;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
    }
    return entry.value;
}
/** Store a value with the given TTL in milliseconds. */
export function setCache(key, value, ttlMs) {
    // Validate ttlMs — must be a finite positive number.
    const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 60_000;
    // Evict oldest entry if we've hit the cap (LRU: Map iterates in insertion order).
    if (store.size >= MAX_ENTRIES && !store.has(key)) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined)
            store.delete(oldest);
    }
    store.set(key, { value, expiresAt: Date.now() + safeTtl });
}
/** Evict all entries (useful for tests). */
export function clearCache() {
    store.clear();
}
//# sourceMappingURL=tool-cache.js.map