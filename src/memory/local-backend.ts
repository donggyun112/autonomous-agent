import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { MemoryGraph } from "./graph.js";
import { DATA } from "../primitives/paths.js";
import type { MemoryBackend } from "./backend.js";

const MEMORY_VERSIONS_FILE = join(DATA, "memory-versions.json");

type MemoryVersion = {
  content: string;
  depth: number;
  timestamp: string;
};

type VersionsMap = Record<string, MemoryVersion[]>;

let _graph: MemoryGraph | null = null;

export async function getLocalGraph(): Promise<MemoryGraph> {
  if (!_graph) {
    _graph = new MemoryGraph();
    await _graph.load();
  }
  return _graph;
}

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

export async function getMemoryHistory(memoryId: string): Promise<MemoryVersion[]> {
  const versions = await loadVersions();
  return versions[memoryId] ?? [];
}

export const localMemoryBackend: MemoryBackend = {
  id: "local",

  async recall(query, topK = 5) {
    const g = await getLocalGraph();
    return g.recall(query, topK);
  },

  async remember(content, keys, options) {
    const g = await getLocalGraph();
    const [id, deduped] = await g.add(content, keys, {
      keyTypes: options?.keyTypes,
      source: options?.source,
      namespace: options?.namespace,
    });
    return { id, deduped };
  },

  async recentMemories(limit = 20) {
    const g = await getLocalGraph();
    return g.listRecent(limit);
  },

  async shallowMemories(maxDepth = 0.3, limit = 20) {
    const g = await getLocalGraph();
    return g.listShallow(maxDepth, limit);
  },

  async dream(args) {
    const g = await getLocalGraph();
    const mem = g.memories[args.memoryId];
    const preDreamSnapshot = mem
      ? { content: mem.content, depth: mem.depth, timestamp: new Date().toISOString() }
      : null;

    const result = g.dream(args);

    if (preDreamSnapshot) {
      try {
        const versions = await loadVersions();
        if (!versions[args.memoryId]) versions[args.memoryId] = [];
        versions[args.memoryId].push(preDreamSnapshot);
        await saveVersions(versions);
      } catch {
        // version history failure should not crash dreaming
      }
    }

    return result;
  },

  async pruneWeak(options) {
    const g = await getLocalGraph();
    return g.pruneWeak(options);
  },

  async deleteMemory(memoryId) {
    const g = await getLocalGraph();
    const result = await g.delete(memoryId);
    await g.save();
    return result;
  },

  async findClusters(options) {
    const g = await getLocalGraph();
    return g.findClusters(options);
  },

  async pickRandomDistantPair() {
    const g = await getLocalGraph();
    return g.pickRandomDistantPair();
  },

  async linkMemories(memA, memB, viaKey) {
    const g = await getLocalGraph();
    return g.link(memA, memB, viaKey);
  },

  async memoryStats() {
    const g = await getLocalGraph();
    return g.stats();
  },
};
