// Lightweight span-based tracing — OTel-inspired, no dependencies.
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";

export type TraceSpan = {
  id: string;
  name: string;
  parent?: string;
  startMs: number;
  endMs?: number;
  metadata?: Record<string, unknown>;
};

const spans: TraceSpan[] = [];
let counter = 0;

export function startSpan(name: string, parent?: string): string {
  const id = `span-${++counter}`;
  spans.push({ id, name, parent, startMs: Date.now() });
  return id;
}

export function endSpan(id: string, metadata?: Record<string, unknown>): void {
  const span = spans.find((s) => s.id === id);
  if (span) {
    span.endMs = Date.now();
    if (metadata) span.metadata = metadata;
  }
}

export function getTrace(): TraceSpan[] { return [...spans]; }

export function resetTrace(): void { spans.length = 0; counter = 0; }

export async function saveTrace(day: number, cycle: number): Promise<void> {
  if (spans.length === 0) return;
  const dir = join(DATA, "traces");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `day-${String(day).padStart(3, "0")}-cycle-${cycle}.json`), JSON.stringify(spans, null, 2), "utf-8");
}
