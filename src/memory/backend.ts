export type MemoryAddOptions = {
  keyTypes?: Record<string, string>;
  source?: Record<string, unknown>;
  namespace?: string;
};

export type MemoryRecord = {
  id: string;
  content: string;
  depth?: number;
  created_at?: number;
  access_count?: number;
  keys?: string[];
  source?: Record<string, unknown> | null;
  namespace?: string;
  links?: string[];
  [key: string]: unknown;
};

export type MemoryStats = {
  keyCount: number;
  memoryCount: number;
  activeMemoryCount: number;
  linkCount: number;
  avgDepth: number;
  avgContentLen: number;
};

export type MemoryBackend = {
  readonly id: "local" | "keymem";
  recall(query: string, topK?: number): Promise<object[]>;
  remember(content: string, keys: string[], options?: MemoryAddOptions): Promise<{ id: string; deduped: boolean }>;
  recentMemories(limit?: number): Promise<MemoryRecord[]>;
  shallowMemories(maxDepth?: number, limit?: number): Promise<MemoryRecord[]>;
  dream(args: { memoryId: string; compressedContent: string; depthIncrement?: number }): Promise<{ id: string; depth: number; previousContent: string }>;
  pruneWeak(options?: { minAgeSec?: number; maxToPrune?: number }): Promise<string[]>;
  deleteMemory(memoryId: string): Promise<boolean>;
  findClusters(options?: { minSharedKeys?: number; minClusterSize?: number; maxClusters?: number }): Promise<Array<{ keys: string[]; memoryIds: string[]; contents: string[] }>>;
  pickRandomDistantPair(): Promise<{ a: { id: string; content: string }; b: { id: string; content: string } } | null>;
  linkMemories(memA: string, memB: string, viaKey: string): Promise<void>;
  memoryStats(): Promise<MemoryStats>;
};
