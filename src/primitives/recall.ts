// PRIMITIVE: recall
//
// The agent's only way to access memory. The default backend is the local
// MemoryGraph; MEMORY_BACKEND=keymem switches to the KeyMem MCP backend.

import type { MemoryBackend } from "../memory/backend.js";
import { memoryBackendKind } from "../memory/backend.js";
import { keymemMcpBackend } from "../memory/keymem-mcp-backend.js";
import {
  getLocalGraph,
  getMemoryHistory as getLocalMemoryHistory,
  localMemoryBackend,
} from "../memory/local-backend.js";

let _backend: MemoryBackend | null = null;

function getBackend(): MemoryBackend {
  if (!_backend) {
    _backend = memoryBackendKind() === "keymem" ? keymemMcpBackend : localMemoryBackend;
  }
  return _backend;
}

export function resetMemoryBackendForTests(): void {
  _backend = null;
}

export const getGraph = getLocalGraph;

export async function recall(query: string, topK = 5): Promise<object[]> {
  return getBackend().recall(query, topK);
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
  return getBackend().remember(content, keys, options);
}

export async function recentMemories(limit = 20) {
  return getBackend().recentMemories(limit);
}

export async function shallowMemories(maxDepth = 0.3, limit = 20) {
  return getBackend().shallowMemories(maxDepth, limit);
}

export async function dream(args: {
  memoryId: string;
  compressedContent: string;
  depthIncrement?: number;
}) {
  return getBackend().dream(args);
}

export async function pruneWeak(options?: { minAgeSec?: number; maxToPrune?: number }) {
  return getBackend().pruneWeak(options);
}

export async function deleteMemory(memoryId: string): Promise<boolean> {
  return getBackend().deleteMemory(memoryId);
}

export async function findClusters(options?: { minSharedKeys?: number; minClusterSize?: number; maxClusters?: number }) {
  return getBackend().findClusters(options);
}

export async function pickRandomDistantPair() {
  return getBackend().pickRandomDistantPair();
}

export async function linkMemories(memA: string, memB: string, viaKey: string) {
  return getBackend().linkMemories(memA, memB, viaKey);
}

export async function memoryStats() {
  return getBackend().memoryStats();
}

//
// Heuristic-based contradiction check. No LLM calls — just looks for
// negation words near key terms that an existing memory affirms, or vice versa.

const NEGATION_WORDS = ["not", "never", "wrong", "incorrect", "false", "no longer", "isn't", "aren't", "wasn't", "doesn't", "don't", "cannot", "can't", "won't"];

function containsNegationNearTerm(text: string, term: string): boolean {
  const lower = text.toLowerCase();
  const termLower = term.toLowerCase();
  const termIdx = lower.indexOf(termLower);
  if (termIdx === -1) return false;
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
  const candidates: { id: string; content: string; memKeys: string[] }[] = [];

  for (const key of keys) {
    try {
      const results = await recall(key, 5);
      for (const r of results) {
        const rec = r as { id?: string; content?: string; matchedKeys?: string[]; keys?: string[] };
        if (rec.id && rec.content && !candidates.some((c) => c.id === rec.id)) {
          candidates.push({
            id: rec.id,
            content: rec.content,
            memKeys: Array.isArray(rec.matchedKeys)
              ? rec.matchedKeys
              : Array.isArray(rec.keys)
                ? rec.keys
                : [],
          });
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

//
// Combines backend recall with a simple text-includes scan of recent memories.
// Merges and deduplicates by memory id.

export async function recallDual(query: string, topK = 5): Promise<object[]> {
  const keyResults = await recall(query, topK);
  const recent = await recentMemories(topK * 3);
  const queryLower = query.toLowerCase();
  const textMatches = recent.filter((m) =>
    m.content.toLowerCase().includes(queryLower),
  );

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

export async function getMemoryHistory(memoryId: string) {
  return getLocalMemoryHistory(memoryId);
}
