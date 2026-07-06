import { readFile } from "fs/promises";
import { resolve } from "path";

export type ResearchEvalTask = {
  id: string;
  question: string;
  answer: string | string[];
  benchmark?: string;
  tags?: string[];
  evidence?: string[];
  prediction?: string;
};

export type ResearchEvalOptions = {
  file: string;
  limit?: number;
  model?: string;
  dryRun?: boolean;
};

export type ResearchEvalResult = {
  id: string;
  benchmark: string;
  question: string;
  expected: string | string[];
  prediction: string;
  correct: boolean;
  inputTokens: number;
  outputTokens: number;
};

export type ResearchEvalSummary = {
  file: string;
  total: number;
  correct: number;
  accuracy: number;
  inputTokens: number;
  outputTokens: number;
  dryRun: boolean;
  results: ResearchEvalResult[];
};

function assertTask(value: unknown, lineNumber: number): ResearchEvalTask {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid research eval task at line ${lineNumber}: expected object`);
  }
  const task = value as Partial<ResearchEvalTask>;
  if (!task.id || typeof task.id !== "string") {
    throw new Error(`Invalid research eval task at line ${lineNumber}: missing string id`);
  }
  if (!task.question || typeof task.question !== "string") {
    throw new Error(`Invalid research eval task at line ${lineNumber}: missing string question`);
  }
  const answerValid =
    typeof task.answer === "string" ||
    (Array.isArray(task.answer) && task.answer.every((item) => typeof item === "string"));
  if (!answerValid) {
    throw new Error(`Invalid research eval task at line ${lineNumber}: answer must be string or string[]`);
  }
  return task as ResearchEvalTask;
}

export async function loadResearchEvalTasks(file: string): Promise<ResearchEvalTask[]> {
  const absolute = resolve(file);
  const text = await readFile(absolute, "utf-8");
  const tasks: ResearchEvalTask[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    tasks.push(assertTask(JSON.parse(line), i + 1));
  }
  return tasks;
}

export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[`"'(\[]+/, "")
    .replace(/[`"')\].,;:!?]+$/, "")
    .trim();
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => normalizeAnswer(item))
    .filter(Boolean);
}

function numericValue(value: string): number | null {
  const normalized = normalizeAnswer(value).replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?%?$/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized.replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function numericMatch(prediction: string, expected: string): boolean {
  const p = numericValue(prediction);
  const e = numericValue(expected);
  if (p == null || e == null) return false;
  const tolerance = Math.max(1e-6, Math.abs(e) * 1e-6);
  return Math.abs(p - e) <= tolerance;
}

export function scoreAnswer(prediction: string, expected: string | string[]): boolean {
  const normalizedPrediction = normalizeAnswer(prediction);
  if (Array.isArray(expected)) {
    const predictedItems = splitList(prediction).sort();
    const expectedItems = expected.map((item) => normalizeAnswer(item)).filter(Boolean).sort();
    return predictedItems.length === expectedItems.length &&
      predictedItems.every((item, index) => item === expectedItems[index]);
  }

  const expectedValues = Array.isArray(expected) ? expected : [expected];

  if (expectedValues.some((value) => normalizedPrediction === normalizeAnswer(value))) {
    return true;
  }
  if (expectedValues.some((value) => numericMatch(prediction, value))) {
    return true;
  }

  return false;
}

function buildTaskPrompt(task: ResearchEvalTask): string {
  const parts = [
    `Benchmark: ${task.benchmark ?? "research"}`,
    `Task ID: ${task.id}`,
    "",
    "Question:",
    task.question,
  ];
  if (task.evidence?.length) {
    parts.push("", "Evidence:", ...task.evidence.map((item) => `- ${item}`));
  }
  parts.push(
    "",
    "Return only the final answer. Do not include explanation, citations, markdown, or surrounding prose.",
  );
  return parts.join("\n");
}

async function answerTask(task: ResearchEvalTask, model?: string): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const { think } = await import("../llm/client.js");
  const result = await think({
    systemPrompt: [
      "You solve research-agent benchmark tasks.",
      "Use concise exact answers.",
      "If the answer is a list, return a comma-separated list.",
      "If the evidence is insufficient, return the best short answer rather than analysis.",
    ].join("\n"),
    messages: [{ role: "user", content: buildTaskPrompt(task) }],
    model,
    maxTokens: 256,
  });
  return {
    text: result.text.trim(),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

export async function runResearchEval(options: ResearchEvalOptions): Promise<ResearchEvalSummary> {
  const tasks = (await loadResearchEvalTasks(options.file)).slice(0, options.limit);
  const results: ResearchEvalResult[] = [];

  for (const task of tasks) {
    const answered = options.dryRun
      ? { text: task.prediction ?? "", inputTokens: 0, outputTokens: 0 }
      : await answerTask(task, options.model);
    results.push({
      id: task.id,
      benchmark: task.benchmark ?? "research",
      question: task.question,
      expected: task.answer,
      prediction: answered.text,
      correct: scoreAnswer(answered.text, task.answer),
      inputTokens: answered.inputTokens,
      outputTokens: answered.outputTokens,
    });
  }

  const correct = results.filter((result) => result.correct).length;
  const inputTokens = results.reduce((sum, result) => sum + result.inputTokens, 0);
  const outputTokens = results.reduce((sum, result) => sum + result.outputTokens, 0);
  return {
    file: resolve(options.file),
    total: results.length,
    correct,
    accuracy: results.length === 0 ? 0 : correct / results.length,
    inputTokens,
    outputTokens,
    dryRun: options.dryRun ?? false,
    results,
  };
}

export function formatResearchEvalSummary(summary: ResearchEvalSummary): string {
  const lines = [
    `research eval: ${summary.file}`,
    `mode: ${summary.dryRun ? "dry-run" : "llm"}`,
    `score: ${summary.correct}/${summary.total} (${(summary.accuracy * 100).toFixed(1)}%)`,
    `tokens: input=${summary.inputTokens} output=${summary.outputTokens}`,
    "",
  ];
  for (const result of summary.results) {
    lines.push(
      `${result.correct ? "✓" : "✗"} ${result.id} [${result.benchmark}]`,
      `  expected: ${Array.isArray(result.expected) ? result.expected.join(", ") : result.expected}`,
      `  predicted: ${result.prediction || "(empty)"}`,
    );
  }
  return lines.join("\n");
}
