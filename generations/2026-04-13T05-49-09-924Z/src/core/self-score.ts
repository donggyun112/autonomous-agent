// Self-improvement scoring — tracks cycle quality over time.
import { appendFile, mkdir, readFile } from "fs/promises";
import { dirname, join } from "path";
import { DATA } from "../primitives/paths.js";

const SCORES_FILE = join(DATA, "self-scores.jsonl");

export type CycleScore = {
  day: number;
  score: number;
  ts: string;
};

export function scoreCycle(report: {
  toolCalls: number;
  errors: number;
  uniqueTools: number;
  totalTurns: number;
}): number {
  let s = 0;
  s += report.uniqueTools * 0.5;
  s -= report.errors * 3;
  const idleRatio = report.totalTurns > 0 ? 1 - (report.toolCalls / report.totalTurns) : 0;
  if (idleRatio > 0.5) s -= 2;
  return Math.round(s * 100) / 100;
}

export async function recordScore(day: number, score: number): Promise<void> {
  await mkdir(dirname(SCORES_FILE), { recursive: true });
  const entry: CycleScore = { day, score, ts: new Date().toISOString() };
  await appendFile(SCORES_FILE, JSON.stringify(entry) + "\n", "utf-8");
}

export async function getScoreTrend(lastN = 10): Promise<{ scores: CycleScore[]; trend: "improving" | "stable" | "declining" }> {
  let lines: string[];
  try {
    const text = await readFile(SCORES_FILE, "utf-8");
    lines = text.split("\n").filter((l) => l.trim());
  } catch {
    return { scores: [], trend: "stable" };
  }
  const all = lines.map((l) => { try { return JSON.parse(l) as CycleScore; } catch { return null; } })
    .filter((s): s is CycleScore => s !== null);
  const recent = all.slice(-lastN);
  if (recent.length < 3) return { scores: recent, trend: "stable" };
  const half = Math.floor(recent.length / 2);
  const first = recent.slice(0, half).reduce((a, b) => a + b.score, 0) / half;
  const second = recent.slice(half).reduce((a, b) => a + b.score, 0) / (recent.length - half);
  const diff = second - first;
  return { scores: recent, trend: diff > 1 ? "improving" : diff < -1 ? "declining" : "stable" };
}
