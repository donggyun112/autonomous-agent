// Trajectory compression — condenses past sessions into brief narratives.
import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";
import { thinkAux } from "../llm/client.js";

const SESSION_ARCHIVE = join(DATA, "session-archive");
const TRAJECTORIES_DIR = join(DATA, "trajectories");

export async function compressTrajectory(archivePath: string): Promise<string> {
  const text = await readFile(archivePath, "utf-8");
  const truncated = text.length > 6000 ? text.slice(0, 6000) + "\n...(truncated)" : text;
  const result = await thinkAux({
    systemPrompt: "Compress an agent session transcript into 3-8 sentences. Extract: key decisions, state transitions, tools used, insights gained. First person, factual.",
    messages: [{ role: "user", content: `Session:\n\n${truncated}\n\nCompress.` }],
    maxTokens: 512,
  });
  return result.text.trim();
}

export async function compressRecentTrajectories(maxFiles = 3): Promise<number> {
  await mkdir(TRAJECTORIES_DIR, { recursive: true });
  let files: string[];
  try {
    files = (await readdir(SESSION_ARCHIVE)).filter((f) => f.endsWith(".jsonl")).sort().slice(-maxFiles);
  } catch { return 0; }
  let count = 0;
  for (const file of files) {
    const outPath = join(TRAJECTORIES_DIR, file.replace(".jsonl", ".md"));
    try { await stat(outPath); continue; } catch { /* not compressed yet */ }
    try {
      const summary = await compressTrajectory(join(SESSION_ARCHIVE, file));
      await writeFile(outPath, `# Trajectory: ${file}\n\n${summary}\n`, "utf-8");
      count++;
    } catch { /* skip */ }
  }
  return count;
}
