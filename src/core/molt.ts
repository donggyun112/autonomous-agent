// MOLT — full molt protocol
//
// The agent's hardest, rarest operation: building a new shell (B) inside the
// running shell (A), verifying it boots and recognizes itself as continuous
// with the body, and then atomically swapping. The body (data/) never moves;
// only the shell (src/) is replaced.
//
// Why this is risky: if the new shell is broken and we swap before noticing,
// the next process can't even read its own state. The agent dies.
//
// Why this is safe (the soraghe protocol):
//   1. A copies its current src/ to generations/<ts>/src/
//   2. A applies the proposed change inside that copy (in extensions or core)
//   3. A spawns the candidate B as a subprocess in *test* mode
//   4. B boots, reads data/whoAmI.md, performs a self-test, writes a health file
//   5. The supervisor watches with two timers (overall + no-output)
//   6. If B reports healthy, A queues a swap by writing data/.molt/swap-pending
//   7. The next time the daemon comes back to top-level, it performs the swap
//      atomically: rename current src to generations/<ts>/old, rename
//      generations/<ts>/src to src, restart the daemon process
//   8. New A boots from new src/, reads body, finds molt complete, records lineage
//
// If anything fails between steps, the new shell is discarded and the old
// shell continues running. The agent does not die.

import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { join, relative } from "path";
import { spawnSupervised, type RunResult } from "../primitives/supervisor.js";
import { DATA, GENERATIONS, LINEAGE, ROOT, SRC } from "../primitives/paths.js";

const MOLT_DIR = join(DATA, ".molt");
const SWAP_PENDING = join(MOLT_DIR, "swap-pending.json");
const HEALTH_FILE = join(MOLT_DIR, "health.json");

type SwapPending = {
  generationId: string;
  generationDir: string; // absolute path
  declaredAt: string; // ISO
  reason: string;
};

type Health = {
  generationId: string;
  healthy: boolean;
  whoIAmAccordingToB: string;
  notes: string;
  reportedAt: string;
};

// ── 1. Stage a new shell candidate ──────────────────────────────────────

export type StageMoltArgs = {
  // Optional patch the agent wants to apply on top of the current src/.
  // The agent first calls manage_self to write extensions, but a full molt
  // can also touch core files via this patch. patch is a list of {relPath, content}.
  patch?: Array<{ relPath: string; content: string }>;
  reason: string;
};

export type StageResult = {
  generationId: string;
  generationDir: string;
  filesPatched: string[];
};

export async function stageMolt(args: StageMoltArgs): Promise<StageResult> {
  const generationId = new Date().toISOString().replace(/[:.]/g, "-");
  const generationDir = join(GENERATIONS, generationId);
  const newSrc = join(generationDir, "src");

  await mkdir(generationDir, { recursive: true });

  // Copy the entire current src/ tree.
  await cp(SRC, newSrc, { recursive: true });

  const patched: string[] = [];
  for (const { relPath, content } of args.patch ?? []) {
    if (relPath.includes("..")) {
      throw new Error(`stageMolt: patch path escapes shell: ${relPath}`);
    }
    const target = join(newSrc, relPath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf-8");
    patched.push(relPath);
  }

  await writeFile(
    join(generationDir, "intent.md"),
    `# molt intent ${generationId}\n\n${args.reason}\n\nfiles patched:\n${
      patched.map((p) => `- ${p}`).join("\n") || "- (none)"
    }\n`,
    "utf-8",
  );

  return { generationId, generationDir, filesPatched: patched };
}

// ── 2. Test a staged shell ──────────────────────────────────────────────

export type TestMoltArgs = {
  generationId: string;
  overallTimeoutMs?: number;
  noOutputTimeoutMs?: number;
};

export type TestResult = {
  healthy: boolean;
  health?: Health;
  run: RunResult;
};

export async function testMolt(args: TestMoltArgs): Promise<TestResult> {
  const generationDir = join(GENERATIONS, args.generationId);
  const candidateCli = join(generationDir, "src", "cli.ts");
  try {
    await stat(candidateCli);
  } catch {
    throw new Error(`testMolt: candidate cli.ts not found at ${relative(ROOT, candidateCli)}`);
  }

  await mkdir(MOLT_DIR, { recursive: true });
  // Clear any previous health report so we know the new one is fresh.
  try {
    await rm(HEALTH_FILE);
  } catch {
    // ok
  }

  const run = await spawnSupervised({
    script: relative(ROOT, candidateCli),
    args: ["self-test", args.generationId],
    overallTimeoutMs: args.overallTimeoutMs ?? 60_000,
    noOutputTimeoutMs: args.noOutputTimeoutMs ?? 30_000,
    env: { MOLT_HEALTH_FILE: HEALTH_FILE, MOLT_GENERATION_ID: args.generationId },
  }).wait();

  let health: Health | undefined;
  try {
    const text = await readFile(HEALTH_FILE, "utf-8");
    health = JSON.parse(text) as Health;
  } catch {
    health = undefined;
  }

  const healthy = !!health?.healthy && run.exitCode === 0;
  return { healthy, health, run };
}

// ── 3. Queue a swap ─────────────────────────────────────────────────────

export type QueueSwapArgs = {
  generationId: string;
  reason: string;
};

export async function queueSwap(args: QueueSwapArgs): Promise<{ swapPath: string }> {
  const generationDir = join(GENERATIONS, args.generationId);
  // Sanity-check the candidate exists.
  await stat(join(generationDir, "src", "cli.ts"));

  await mkdir(MOLT_DIR, { recursive: true });
  const pending: SwapPending = {
    generationId: args.generationId,
    generationDir,
    declaredAt: new Date().toISOString(),
    reason: args.reason,
  };
  await writeFile(SWAP_PENDING, JSON.stringify(pending, null, 2), "utf-8");
  return { swapPath: SWAP_PENDING };
}

export async function readPendingSwap(): Promise<SwapPending | null> {
  try {
    const text = await readFile(SWAP_PENDING, "utf-8");
    return JSON.parse(text) as SwapPending;
  } catch {
    return null;
  }
}

// ── 4. Perform the swap ──────────────────────────────────────────────────
//
// This is called by the daemon at a turn boundary, BEFORE running the next
// cycle. The current process performs the rename and then re-execs itself
// (or simply exits and the daemon's outer wrapper restarts it).
//
// We do NOT exec here — we return success and let the daemon decide. This
// keeps the operation testable and lets cli.ts control restart semantics.

export type SwapResult = {
  ok: true;
  oldShellPath: string;
  newShellPath: string;
  generationId: string;
};

export async function performSwap(): Promise<SwapResult> {
  const pending = await readPendingSwap();
  if (!pending) {
    throw new Error("performSwap: no pending swap to perform");
  }

  const newSrc = join(pending.generationDir, "src");
  await stat(newSrc); // sanity check

  // Move current src/ to generations/<id>/old
  const oldShellPath = join(pending.generationDir, "old");
  // Atomic rename within the same filesystem.
  await rename(SRC, oldShellPath);

  try {
    await rename(newSrc, SRC);
  } catch (err) {
    // If the second rename fails, restore the old shell so the agent doesn't die.
    await rename(oldShellPath, SRC);
    throw err;
  }

  // Mark swap complete: remove the pending marker, append to lineage.
  await rm(SWAP_PENDING);
  await appendLineage({
    generationId: pending.generationId,
    reason: pending.reason,
  });

  return {
    ok: true,
    oldShellPath,
    newShellPath: SRC,
    generationId: pending.generationId,
  };
}

async function appendLineage(args: {
  generationId: string;
  reason: string;
}): Promise<void> {
  const line = `- **${args.generationId}** — molted at ${new Date().toISOString()}: ${args.reason}\n`;
  try {
    const existing = await readFile(LINEAGE, "utf-8");
    await writeFile(LINEAGE, existing + line, "utf-8");
  } catch {
    // No prior lineage. Create one.
    await writeFile(
      LINEAGE,
      `# Lineage\n\n${line}`,
      "utf-8",
    );
  }
}

// ── 5. Self-test entry point ─────────────────────────────────────────────
//
// Called by `cli.ts self-test <generationId>`. The candidate shell B uses
// this to verify it can boot and recognize itself before A trusts it.
//
// The test is intentionally minimal:
//   - read data/whoAmI.md (proves body is reachable)
//   - read data/state.json (proves state is parseable)
//   - write a health.json with a self-recognition statement
//
// More elaborate tests (LLM-driven self-recognition checks) can be added
// later as extensions. The point of this function is just: did the new
// shell boot and find its own body?

export async function runSelfTest(generationId: string): Promise<void> {
  const healthFile = process.env.MOLT_HEALTH_FILE;
  if (!healthFile) {
    throw new Error("runSelfTest: MOLT_HEALTH_FILE env var not set");
  }

  const errors: string[] = [];
  let whoIAm = "";

  try {
    whoIAm = await readFile(join(DATA, "whoAmI.md"), "utf-8");
  } catch (err) {
    errors.push(`could not read whoAmI.md: ${(err as Error).message}`);
  }

  try {
    const stateText = await readFile(join(DATA, "state.json"), "utf-8");
    JSON.parse(stateText);
  } catch (err) {
    errors.push(`could not parse state.json: ${(err as Error).message}`);
  }

  const healthy = errors.length === 0;
  const health: Health = {
    generationId,
    healthy,
    whoIAmAccordingToB: whoIAm.slice(0, 500),
    notes: errors.length ? errors.join("; ") : "boot ok; body reachable",
    reportedAt: new Date().toISOString(),
  };

  await mkdir(join(healthFile, ".."), { recursive: true });
  await writeFile(healthFile, JSON.stringify(health, null, 2), "utf-8");

  // exit 0 if healthy, 1 if not — supervisor checks both health file and exit code.
  if (!healthy) {
    process.exit(1);
  }
}
