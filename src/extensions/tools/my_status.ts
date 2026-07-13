import type { Tool } from "../../core/tools.js";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { DATA, SRC } from "../../primitives/paths.js";

async function countFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.filter((e) => typeof e === "string").length;
  } catch {
    return 0;
  }
}

async function getMemoryInfo(): Promise<{ count: number; keys: Set<string>; capacity: string }> {
  const memoryDir = join(DATA, "memory");
  try {
    const files = await readdir(memoryDir);
    const memFiles = files.filter((f) => f.endsWith(".json"));
    let allKeys = new Set<string>();
    for (const file of memFiles) {
      try {
        const content = await readFile(join(memoryDir, file), "utf-8");
        const parsed = JSON.parse(content);
        if (parsed.keys) {
          parsed.keys.forEach((k: string) => allKeys.add(k));
        }
      } catch {}
    }
    return { count: memFiles.length, keys: allKeys, capacity: `${memFiles.length} files` };
  } catch {
    return { count: 0, keys: new Set(), capacity: "empty" };
  }
}

async function getJournalCount(): Promise<number> {
  const journalDir = join(DATA, "journal");
  try {
    const files = await readdir(journalDir);
    return files.filter((f) => f.startsWith("day-") && f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

export const tool: Tool = {
  def: {
    name: "my_status",
    description: "현재 나의 상태(모드, 사이클, 턴 수, 메모리 용량, journal 기록 수)를 요약하여 보여준다.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => {
    const { loadState } = await import("../../core/state.js");
    const state = await loadState();

    const memInfo = await getMemoryInfo();
    const journalCount = await getJournalCount();
    const srcFiles = await countFiles(SRC);
    const dataFiles = await countFiles(DATA);

    return JSON.stringify({
      mode: state.mode,
      cycle: state.cycle,
      totalTurns: state.totalTurns,
      awakeMs: `${(state.awakeMs / 1000).toFixed(1)} seconds`,
      sleepCount: state.sleepCount,
      memoryCount: memInfo.count,
      memoryKeys: Array.from(memInfo.keys),
      journalEntries: journalCount,
      srcFiles,
      dataFiles,
    }, null, 2);
  },
};