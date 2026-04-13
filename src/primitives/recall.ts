// PRIMITIVE: recall
//
// The agent's only way to access its memory graph.
// Wraps the vendored super-memory MemoryGraph.

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { MemoryGraph } from "../memory/graph.js";
import { DATA } from "./paths.js";

let _graph: MemoryGraph | null = null;

const MEMORY_VERSIONS_FILE = join(DATA, "memory-versions.json");

export async function getGraph(): Promise<MemoryGraph> {
  if (!_graph) {
    _graph = new MemoryGraph();
    await _graph.load();
  }
  return _graph;
}

export async function recall(
  query: string,
  topK = 5,
): Promise<object[]> {
  const g = await getGraph();
  return g.recall(query, topK);
}

export async function remember(
  content: string,
  keys: string[],
  options?: {
    keyTypes?: Record<string, string>;
    source?: Record<string, unknown>;
    namespace?: string;
  },
): Promise<{ id: string; deduped: boolean }> {
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

export async function dream(args: {
  memoryId: string;
  compressedContent: string;
  depthIncrement?: number;
}) {
  const g = await getGraph();

  // #14: Save current content to version history before dreaming.
  const mem = g.memories[args.memoryId];
  if (mem) {
    const versions = await loadVersions();
    if (!versions[args.memoryId]) versions[args.memoryId] = [];
    versions[args.memoryId].push({
      content: mem.content,
      depth: mem.depth,
      timestamp: new Date().toISOString(),
    });
    await saveVersions(versions);
  }

  return g.dream(args);
}

export async function pruneWeak(options?: { minAgeSec?: number; maxToPrune?: number }) {
  const g = await getGraph();
  return g.pruneWeak(options);
}

export async function findClusters(options?: { minSharedKeys?: number; minClusterSize?: number; maxClusters?: number }) {
  const g = await getGraph();
  return g.findClusters(options);
}

export async function pickRandomDistantPair() {
  const g = await getGraph();
  return g.pickRandomDistantPair();
}

export async function linkMemories(memA: string, memB: string, viaKey: string) {
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

function containsNegationNearTerm(text: string, term: string): boolean {
  const lower = text.toLowerCase();
  const termLower = term.toLowerCase();
  const termIdx = lower.indexOf(termLower);
  if (termIdx === -1) return false;
  // Check within a window of 80 chars around the term
  const windowStart = Math.max(0, termIdx - 80);
  const windowEnd = Math.min(lower.length, termIdx + termLower.length + 80);
  const window = lower.slice(windowStart, windowEnd);
  return NEGATION_WORDS.some((neg) => window.includes(neg));
}

export async function checkContradiction(
  newContent: string,
  keys: string[],
): Promise<{
  hasContradiction: boolean;
  conflicting?: { id: string; content: string; keys: string[] };
}> {
  const g = await getGraph();
  // Search for existing memories with overlapping keys
  const candidates: { id: string; content: string; memKeys: string[] }[] = [];

  for (const key of keys) {
    try {
      const results = await g.recall(key, 5);
      for (const r of results) {
        const rec = r as { id?: string; content?: string; matchedKeys?: string[] };
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
    } catch {
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

export async function recallDual(
  query: string,
  topK = 5,
): Promise<object[]> {
  // Path 1: standard key-based recall
  const keyResults = await recall(query, topK);

  // Path 2: recent memories with text-includes check
  const recent = await recentMemories(topK * 3);
  const queryLower = query.toLowerCase();
  const textMatches = recent.filter((m) =>
    m.content.toLowerCase().includes(queryLower),
  );

  // Merge and deduplicate by id
  const seen = new Set<string>();
  const merged: object[] = [];

  for (const r of keyResults) {
    const rec = r as { id?: string };
    if (rec.id) {
      if (!seen.has(rec.id)) {
        seen.add(rec.id);
        merged.push(r);
      }
    } else {
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

// ── #14 Memory Versioning ───────────────────────────────────────────────
//
// Tracks version history of memories that are modified by dream().
// Versions are stored in data/memory-versions.json.

type MemoryVersion = {
  content: string;
  depth: number;
  timestamp: string;
};

type VersionsMap = Record<string, MemoryVersion[]>;

async function loadVersions(): Promise<VersionsMap> {
  try {
    const raw = await readFile(MEMORY_VERSIONS_FILE, "utf-8");
    return JSON.parse(raw) as VersionsMap;
  } catch {
    return {};
  }
}

async function saveVersions(versions: VersionsMap): Promise<void> {
  await mkdir(dirname(MEMORY_VERSIONS_FILE), { recursive: true });
  await writeFile(MEMORY_VERSIONS_FILE, JSON.stringify(versions, null, 2), "utf-8");
}

export async function getMemoryHistory(
  memoryId: string,
): Promise<MemoryVersion[]> {
  const versions = await loadVersions();
  return versions[memoryId] ?? [];
}
