// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// The molt protocol itself cannot be mutated through manage_self. Changing
// how molting works is a meta-level change — it must be done via a molt
// that the current (working) protocol carries out, with extra care.
// ===========================================================================
//
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
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { join, relative } from "path";
import { isDockerAvailable, spawnSupervised, type RunResult } from "../primitives/supervisor.js";
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

// Simplicity — autoagent principle: "all else being equal, simpler is better".
// We don't block a molt for failing the simplicity check, but we surface the
// delta so the agent (and the human reading lineage.md later) can see whether
// the shell is growing or shrinking. Negative delta = fewer lines/files = simpler.
export type SimplicityDelta = {
  lineCountBefore: number;
  lineCountAfter: number;
  fileCountBefore: number;
  fileCountAfter: number;
  linesDelta: number;
  filesDelta: number;
  simpler: boolean;
};

export type TestIsolation = "docker" | "host";

export type TestResult = {
  healthy: boolean;
  health?: Health;
  run: RunResult;
  simplicity: SimplicityDelta;
  isolation: TestIsolation;
};

// Docker image built from the project Dockerfile. The molt test mounts the
// candidate src/ into /agent/src (read-only) and the parent body into
// /agent/data (read-write for health.json), then runs `self-test` inside.
//
// `--network none` blocks outgoing network so the candidate can't exfiltrate
// or phone home during test. The real agent gets network in normal runs;
// this is only to isolate the unverified candidate.
const MOLT_IMAGE = "autonomous-agent:latest";

function buildDockerRunArgs(args: {
  generationId: string;
  generationDir: string;
  realDataDir: string;
  healthFileContainer: string;
}): string[] {
  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=64m",
    // The candidate shell's src/ — mounted read-only at /agent/src.
    "-v",
    `${join(args.generationDir, "src")}:/agent/src:ro`,
    // The real body — mounted read-write at /agent/data.
    "-v",
    `${args.realDataDir}:/agent/data`,
    "-e",
    `MOLT_HEALTH_FILE=${args.healthFileContainer}`,
    "-e",
    `MOLT_GENERATION_ID=${args.generationId}`,
    "-e",
    "AGENT_ROOT=/agent",
    "-e",
    "AGENT_DATA_DIR=/agent/data",
    // Explicitly DO NOT forward ANTHROPIC_API_KEY or OAuth creds — the
    // self-test does not need to call the LLM and we don't want an untested
    // shell to have access to our credentials. If it tries to call the LLM,
    // it will fail, and that's fine.
    MOLT_IMAGE,
    "self-test",
    args.generationId,
  ];
}

async function countCodeLines(dir: string): Promise<{ lines: number; files: number }> {
  let lines = 0;
  let files = 0;
  async function walk(path: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /\.(ts|md)$/.test(entry.name)) {
        files += 1;
        try {
          const text = await readFile(full, "utf-8");
          lines += text.split("\n").length;
        } catch {
          // skip
        }
      }
    }
  }
  await walk(dir);
  return { lines, files };
}

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

  const realDataDir = join(ROOT, "data");

  // Prefer Docker for real isolation. Fall back to host spawn only if Docker
  // isn't available — that's the old behavior and is strictly less safe.
  let run: RunResult;
  let isolation: TestIsolation;

  if (isDockerAvailable()) {
    isolation = "docker";
    // Inside the container, the health file is at /agent/data/.molt/health.json.
    // From the host, that's the same file via the volume mount (data/.molt/health.json).
    const healthFileContainer = "/agent/data/.molt/health.json";
    run = await spawnSupervised({
      cmd: "docker",
      cmdArgs: buildDockerRunArgs({
        generationId: args.generationId,
        generationDir,
        realDataDir,
        healthFileContainer,
      }),
      overallTimeoutMs: args.overallTimeoutMs ?? 120_000,
      noOutputTimeoutMs: args.noOutputTimeoutMs ?? 60_000,
    }).wait();
  } else {
    isolation = "host";
    run = await spawnSupervised({
      script: relative(ROOT, candidateCli),
      args: ["self-test", args.generationId],
      overallTimeoutMs: args.overallTimeoutMs ?? 60_000,
      noOutputTimeoutMs: args.noOutputTimeoutMs ?? 30_000,
      env: {
        MOLT_HEALTH_FILE: HEALTH_FILE,
        MOLT_GENERATION_ID: args.generationId,
        // Critical — B lives in generations/<id>/src/ but its body is the
        // parent's data/. Without these, B's paths.ts would resolve DATA to
        // generations/<id>/data/ which doesn't exist.
        AGENT_ROOT: ROOT,
        AGENT_DATA_DIR: realDataDir,
      },
    }).wait();
  }

  let health: Health | undefined;
  try {
    const text = await readFile(HEALTH_FILE, "utf-8");
    health = JSON.parse(text) as Health;
  } catch {
    health = undefined;
  }

  const healthy = !!health?.healthy && run.exitCode === 0;

  // Simplicity delta — compare current SRC with the candidate generation src.
  const currentCounts = await countCodeLines(SRC);
  const candidateCounts = await countCodeLines(join(generationDir, "src"));
  const simplicity: SimplicityDelta = {
    lineCountBefore: currentCounts.lines,
    lineCountAfter: candidateCounts.lines,
    fileCountBefore: currentCounts.files,
    fileCountAfter: candidateCounts.files,
    linesDelta: candidateCounts.lines - currentCounts.lines,
    filesDelta: candidateCounts.files - currentCounts.files,
    simpler: candidateCounts.lines < currentCounts.lines,
  };

  return { healthy, health, run, simplicity, isolation };
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
