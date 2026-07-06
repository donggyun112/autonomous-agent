import { getLocalGraph } from "./local-backend.js";
import { keymemMcpBackend, stopKeymemMcpBackend } from "./keymem-mcp-backend.js";
import type { Memory } from "./types.js";

export type KeymemMigrationEntry = {
  oldId: string;
  content: string;
  keys: string[];
  keyTypes: Record<string, string>;
  namespace: string;
  source: Record<string, unknown>;
};

export type KeymemMigrationOptions = {
  dryRun?: boolean;
  limit?: number;
};

function isExpired(memory: Memory): boolean {
  return memory.ttl != null && Date.now() / 1000 > memory.ttl;
}

export async function collectLocalMemoryMigrationEntries(
  options: KeymemMigrationOptions = {},
): Promise<KeymemMigrationEntry[]> {
  const graph = await getLocalGraph();
  const superseded = new Set(
    Object.values(graph.memories)
      .map((memory) => memory.supersedes)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const entries: KeymemMigrationEntry[] = [];
  for (const [oldId, memory] of Object.entries(graph.memories)) {
    if (superseded.has(oldId) || isExpired(memory)) continue;
    const keys = graph.getKeysForMemory(oldId);
    const keyTypes: Record<string, string> = {};
    for (const key of Object.values(graph.keys)) {
      if (keys.includes(key.concept)) keyTypes[key.concept] = key.key_type;
    }
    entries.push({
      oldId,
      content: memory.content,
      keys,
      keyTypes,
      namespace: memory.namespace,
      source: {
        ...(memory.source ?? {}),
        migrated_from: "local-memory-graph",
        old_id: oldId,
        old_created_at: memory.created_at,
        old_depth: memory.depth,
        old_access_count: memory.access_count,
      },
    });
    if (options.limit && entries.length >= options.limit) break;
  }
  return entries;
}

export async function migrateLocalMemoriesToKeymem(
  options: KeymemMigrationOptions = {},
): Promise<{
  dryRun: boolean;
  planned: number;
  migrated: number;
  failed: Array<{ oldId: string; error: string }>;
  preview: KeymemMigrationEntry[];
}> {
  const entries = await collectLocalMemoryMigrationEntries(options);
  if (options.dryRun) {
    return {
      dryRun: true,
      planned: entries.length,
      migrated: 0,
      failed: [],
      preview: entries.slice(0, 5),
    };
  }

  let migrated = 0;
  const failed: Array<{ oldId: string; error: string }> = [];
  try {
    for (const entry of entries) {
      try {
        await keymemMcpBackend.remember(entry.content, entry.keys, {
          keyTypes: entry.keyTypes,
          namespace: entry.namespace,
          source: entry.source,
        });
        migrated += 1;
      } catch (err) {
        failed.push({ oldId: entry.oldId, error: (err as Error).message });
      }
    }
  } finally {
    stopKeymemMcpBackend();
  }

  return {
    dryRun: false,
    planned: entries.length,
    migrated,
    failed,
    preview: entries.slice(0, 5),
  };
}
