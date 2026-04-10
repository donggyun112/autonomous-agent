// PRIMITIVE: recall
//
// The agent's only way to access its memory graph.
// Wraps the vendored super-memory MemoryGraph.

import { MemoryGraph } from "../memory/graph.js";

let _graph: MemoryGraph | null = null;

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
