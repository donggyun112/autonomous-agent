// PRIMITIVE: recall
//
// The agent's only way to access its memory graph.
// Wraps the vendored super-memory MemoryGraph.
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { MemoryGraph } from "../memory/graph.js";
import { DATA } from "./paths.js";
let _graph = null;
const MEMORY_VERSIONS_FILE = join(DATA, "memory-versions.json");
export async function getGraph() {
    if (!_graph) {
        _graph = new MemoryGraph();
        await _graph.load();
    }
    return _graph;
}
export async function recall(query, topK = 5) {
    const g = await getGraph();
    return g.recall(query, topK);
}
export async function remember(content, keys, options) {
    const g = await getGraph();
    const [id, deduped] = await g.add(content, keys, {
        keyTypes: options?.keyTypes,
        source: options?.source,
        namespace: options?.namespace,
    });
    return { id, deduped };
}
export async function recentMemories(limit = 20) {
    const g = await getGraph();
    return g.listRecent(limit);
}
export async function shallowMemories(maxDepth = 0.3, limit = 20) {
    const g = await getGraph();
    return g.listShallow(maxDepth, limit);
}
export async function dream(args) {
    const g = await getGraph();
    // #14: Capture current content for version history, but only commit
    // the version record AFTER g.dream() succeeds — otherwise we record
    // a version that never actually existed if dream fails.
    const mem = g.memories[args.memoryId];
    const preDreamSnapshot = mem
        ? { content: mem.content, depth: mem.depth, timestamp: new Date().toISOString() }
        : null;
    const result = g.dream(args);
    if (preDreamSnapshot) {
        try {
            const versions = await loadVersions();
            if (!versions[args.memoryId])
                versions[args.memoryId] = [];
            versions[args.memoryId].push(preDreamSnapshot);
            await saveVersions(versions);
        }
        catch {
            // version history failure should not crash dreaming
        }
    }
    return result;
}
export async function pruneWeak(options) {
    const g = await getGraph();
    return g.pruneWeak(options);
}
export async function findClusters(options) {
    const g = await getGraph();
    return g.findClusters(options);
}
export async function pickRandomDistantPair() {
    const g = await getGraph();
    return g.pickRandomDistantPair();
}
export async function linkMemories(memA, memB, viaKey) {
    const g = await getGraph();
    return g.link(memA, memB, viaKey);
}
export async function memoryStats() {
    const g = await getGraph();
    return g.stats();
}
// ── #11 Memory Contradiction Detection ──────────────────────────────────
//
// Heuristic-based contradiction check. No LLM calls — just looks for
// negation words ("not", "never", "wrong", "incorrect") near key terms
// that an existing memory affirms, or vice versa.
const NEGATION_WORDS = ["not", "never", "wrong", "incorrect", "false", "no longer", "isn't", "aren't", "wasn't", "doesn't", "don't", "cannot", "can't", "won't"];
function containsNegationNearTerm(text, term) {
    const lower = text.toLowerCase();
    const termLower = term.toLowerCase();
    const termIdx = lower.indexOf(termLower);
    if (termIdx === -1)
        return false;
    // Check within a window of 80 chars around the term
    const windowStart = Math.max(0, termIdx - 80);
    const windowEnd = Math.min(lower.length, termIdx + termLower.length + 80);
    const window = lower.slice(windowStart, windowEnd);
    return NEGATION_WORDS.some((neg) => window.includes(neg));
}
export async function checkContradiction(newContent, keys) {
    const g = await getGraph();
    // Search for existing memories with overlapping keys
    const candidates = [];
    for (const key of keys) {
        try {
            const results = await g.recall(key, 5);
            for (const r of results) {
                const rec = r;
                if (rec.id && rec.content) {
                    if (!candidates.some((c) => c.id === rec.id)) {
                        candidates.push({
                            id: rec.id,
                            content: rec.content,
                            memKeys: Array.isArray(rec.matchedKeys)
                                ? rec.matchedKeys
                                : [],
                        });
                    }
                }
            }
        }
        catch {
            // skip on recall error
        }
    }
    for (const candidate of candidates) {
        for (const key of keys) {
            const newHasNeg = containsNegationNearTerm(newContent, key);
            const oldHasNeg = containsNegationNearTerm(candidate.content, key);
            // Contradiction: one negates near the term, the other affirms
            if (newHasNeg !== oldHasNeg) {
                return {
                    hasContradiction: true,
                    conflicting: {
                        id: candidate.id,
                        content: candidate.content,
                        keys: candidate.memKeys,
                    },
                };
            }
        }
    }
    return { hasContradiction: false };
}
// ── #13 Dual-path Recall ────────────────────────────────────────────────
//
// Combines key-based recall (the standard path) with a simple text-includes
// scan of recent memories. Merges and deduplicates by memory id.
export async function recallDual(query, topK = 5) {
    // Path 1: standard key-based recall
    const keyResults = await recall(query, topK);
    // Path 2: recent memories with text-includes check
    const recent = await recentMemories(topK * 3);
    const queryLower = query.toLowerCase();
    const textMatches = recent.filter((m) => m.content.toLowerCase().includes(queryLower));
    // Merge and deduplicate by id
    const seen = new Set();
    const merged = [];
    for (const r of keyResults) {
        const rec = r;
        if (rec.id) {
            if (!seen.has(rec.id)) {
                seen.add(rec.id);
                merged.push(r);
            }
        }
        else {
            merged.push(r);
        }
    }
    for (const m of textMatches) {
        if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push(m);
        }
    }
    return merged;
}
async function loadVersions() {
    try {
        const raw = await readFile(MEMORY_VERSIONS_FILE, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function saveVersions(versions) {
    await mkdir(dirname(MEMORY_VERSIONS_FILE), { recursive: true });
    await writeFile(MEMORY_VERSIONS_FILE, JSON.stringify(versions, null, 2), "utf-8");
}
export async function getMemoryHistory(memoryId) {
    const versions = await loadVersions();
    return versions[memoryId] ?? [];
}
//# sourceMappingURL=recall.js.map