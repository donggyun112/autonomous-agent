// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// The molt protocol itself cannot be mutated through manage_self. Changing
// how molting works is a meta-level change — it must be done via a molt
// that the current (working) protocol carries out, with extra care.
// ===========================================================================
//
// MOLT — image-based full molt protocol (the real soraghe).
//
// The shell is not the `src/` directory. The shell is the entire Docker
// IMAGE: base OS, Node runtime, installed dependencies, source code. When
// the agent molts, it does not shuffle files — it builds a new image and
// migrates into it.
//
// Flow:
//
//   1. stageMolt(reason, patch?)
//      - copies the full build context (src/, package.json, pnpm-lock.yaml,
//        tsconfig.json, Dockerfile) from the current project into
//        generations/<id>/
//      - applies any patches to any of those files
//      - runs `docker build -t autonomous-agent:<id> generations/<id>/`
//      - writes intent.md
//      - returns { generationId, imageTag, filesPatched }
//
//   2. testMolt(generationId)
//      - runs `docker run --rm --network none -v data:/agent/data
//              autonomous-agent:<id> self-test <id>`
//      - the candidate boots in its NEW image, reads the real body, writes
//        a health file, exits
//      - A is still running untouched in its current container
//      - returns { healthy, run, simplicity, health }
//
//   3. molt_swap(generationId, reason)
//      - retags images: current → previous-<ts>, <id> → current
//      - writes lineage entry
//      - writes data/.molt/swap-pending.json (informational, not required
//        for swap — compose restart policy + the new :current tag do the
//        work)
//      - exits 75 — compose auto-restarts, picks up the new :current image
//
// The agent needs docker CLI + /var/run/docker.sock mounted to do any of
// this. See Dockerfile and docker-compose.yml.

import { spawn } from "child_process";
import {
  cp,
  mkdir,
  readdir,
  readFile,
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

// The rolling tag — whatever image this points at is what the compose
// service will boot next. Molt swap updates this.
const CURRENT_TAG = "autonomous-agent:current";

function imageTagFor(generationId: string): string {
  // Docker tags are alphanumerics + [._-]. Our generationIds are ISO
  // timestamps with colons already replaced by dashes in the filename,
  // so they're safe to use as-is.
  return `autonomous-agent:${generationId}`;
}

// ── Types ────────────────────────────────────────────────────────────────

export type SimplicityDelta = {
  lineCountBefore: number;
  lineCountAfter: number;
  fileCountBefore: number;
  fileCountAfter: number;
  linesDelta: number;
  filesDelta: number;
  simpler: boolean;
};

type Health = {
  generationId: string;
  healthy: boolean;
  whoIAmAccordingToB: string;
  notes: string;
  reportedAt: string;
};

type SwapPending = {
  generationId: string;
  imageTag: string;
  previousTag: string;
  declaredAt: string;
  reason: string;
};

// ── 1. Stage ─────────────────────────────────────────────────────────────

export type StageMoltArgs = {
  reason: string;
  // Optional patches applied to the staged build context.
  // relPath is relative to generations/<id>/ — so you can patch src/ or
  // Dockerfile or package.json alike.
  patch?: Array<{ relPath: string; content: string }>;
};

export type StageResult = {
  generationId: string;
  generationDir: string;
  imageTag: string;
  filesPatched: string[];
  buildStdout: string;
  buildStderr: string;
};

// Files copied into the build context. Each must exist at ROOT.
// The agent can patch any of these through the `patch` argument.
const BUILD_CONTEXT_FILES = [
  "src",
  "Dockerfile",
  ".dockerignore",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];

export async function stageMolt(args: StageMoltArgs): Promise<StageResult> {
  if (!isDockerAvailable()) {
    throw new Error(
      "stageMolt: docker is not available. Molt requires docker because the shell is a docker image.",
    );
  }

  const generationId = new Date().toISOString().replace(/[:.]/g, "-");
  const generationDir = join(GENERATIONS, generationId);
  await mkdir(generationDir, { recursive: true });

  // Copy each file/dir in the build context from the project root.
  for (const name of BUILD_CONTEXT_FILES) {
    const srcPath = join(ROOT, name);
    const dstPath = join(generationDir, name);
    try {
      await stat(srcPath);
    } catch {
      // Missing optional file (e.g., .dockerignore) — skip.
      continue;
    }
    await cp(srcPath, dstPath, { recursive: true });
  }

  // Apply patches.
  const patched: string[] = [];
  for (const { relPath, content } of args.patch ?? []) {
    // Reject traversal AND absolute paths. path.join(base, "/abs") ignores
    // base, so an absolute relPath would write outside the generation dir.
    if (relPath.includes("..") || relPath.startsWith("/") || /^[A-Za-z]:/.test(relPath)) {
      throw new Error(`stageMolt: patch path must be relative and inside generation dir: ${relPath}`);
    }
    const target = join(generationDir, relPath);
    // Double-check the resolved target is actually inside generationDir.
    if (!target.startsWith(generationDir + "/") && target !== generationDir) {
      throw new Error(`stageMolt: resolved patch path escapes generation dir: ${relPath}`);
    }
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf-8");
    patched.push(relPath);
  }

  // Write intent before building so there's a record even if build fails.
  await writeFile(
    join(generationDir, "intent.md"),
    `# molt intent ${generationId}\n\n${args.reason}\n\nfiles patched:\n${
      patched.map((p) => `- ${p}`).join("\n") || "- (none)"
    }\n\ntarget image tag: ${imageTagFor(generationId)}\n`,
    "utf-8",
  );

  // Build the new image. This is the actual shell creation — the agent is
  // literally constructing a new runtime environment for itself.
  const imageTag = imageTagFor(generationId);
  const build = await spawnSupervised({
    cmd: "docker",
    cmdArgs: ["build", "-t", imageTag, "-f", join(generationDir, "Dockerfile"), generationDir],
    overallTimeoutMs: 10 * 60 * 1000,   // 10min for docker build
    noOutputTimeoutMs: 3 * 60 * 1000,   // 3min no-output
  }).wait();

  if (build.exitCode !== 0) {
    // Build failed. Record the failure and throw — the agent should
    // handle this gracefully and try again with a different patch.
    await writeFile(
      join(generationDir, "build-error.log"),
      `exit: ${build.exitCode}\n\nstdout:\n${build.stdout}\n\nstderr:\n${build.stderr}\n`,
      "utf-8",
    );
    throw new Error(
      `stageMolt: docker build failed (exit ${build.exitCode}). See ${relative(ROOT, generationDir)}/build-error.log`,
    );
  }

  return {
    generationId,
    generationDir,
    imageTag,
    filesPatched: patched,
    buildStdout: build.stdout.slice(-2000),
    buildStderr: build.stderr.slice(-2000),
  };
}

// ── 2. Test ──────────────────────────────────────────────────────────────

export type TestMoltArgs = {
  generationId: string;
  overallTimeoutMs?: number;
  noOutputTimeoutMs?: number;
};

export type TestResult = {
  healthy: boolean;
  imageTag: string;
  health?: Health;
  run: RunResult;
  simplicity: SimplicityDelta;
};

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
  if (!isDockerAvailable()) {
    throw new Error("testMolt: docker not available.");
  }

  const generationDir = join(GENERATIONS, args.generationId);
  try {
    await stat(generationDir);
  } catch {
    throw new Error(`testMolt: generation dir not found: ${args.generationId}`);
  }
  const imageTag = imageTagFor(args.generationId);

  await mkdir(MOLT_DIR, { recursive: true });
  try {
    await rm(HEALTH_FILE);
  } catch {
    // ok
  }

  // P1-2 fix: docker -v paths are resolved by the HOST docker daemon, not
  // by the calling container. When running inside a container, ROOT resolves
  // to /agent which is a container-local path. We need the HOST path.
  //
  // Convention: the compose service mounts the host's ./data at /agent/data.
  // We read the host mount source from AGENT_HOST_DATA_DIR env var (set in
  // docker-compose.yml) or fall back to ROOT/data (works when running on host).
  const hostDataDir = process.env.AGENT_HOST_DATA_DIR || join(ROOT, "data");
  const hostGenerationsDir = process.env.AGENT_HOST_GENERATIONS_DIR || join(ROOT, "generations");

  // P1-3 fix: the candidate gets the body READ-ONLY so a broken/malicious
  // self-test cannot corrupt production data. The health.json is written to
  // a separate tmpfs at /health inside the candidate container. After the
  // container exits we read health.json from the HOST-side .molt/ dir, which
  // we mount as a small writable volume specifically for health output.
  const healthDir = join(hostDataDir, ".molt");
  const healthFileContainer = "/health/health.json";

  // P1-4 fix: give the container a unique name so we can `docker stop` it
  // if the supervisor times out. With --rm, killing the CLI also triggers
  // Docker daemon to SIGTERM → wait → SIGKILL the container. --stop-timeout=5
  // reduces the grace period so orphans die faster.
  const containerName = `molt-test-${args.generationId.slice(0, 20)}`;

  const run = await spawnSupervised({
    cmd: "docker",
    cmdArgs: [
      "run",
      "--rm",
      "--name",
      containerName,
      "--stop-timeout=5",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=64m",
      // Body: READ-ONLY so candidate cannot corrupt production data.
      "-v",
      `${hostDataDir}:/agent/data:ro`,
      // Health output: small writable mount just for health.json.
      "-v",
      `${healthDir}:/health`,
      // Generations: read-only access for simplicity checks.
      "-v",
      `${hostGenerationsDir}:/agent/generations:ro`,
      "-e",
      `MOLT_HEALTH_FILE=${healthFileContainer}`,
      "-e",
      `MOLT_GENERATION_ID=${args.generationId}`,
      "-e",
      "AGENT_ROOT=/agent",
      "-e",
      "AGENT_DATA_DIR=/agent/data",
      // Do NOT forward ANTHROPIC_API_KEY — untested B does not get LLM access.
      imageTag,
      "self-test",
      args.generationId,
    ],
    overallTimeoutMs: args.overallTimeoutMs ?? 120_000,
    noOutputTimeoutMs: args.noOutputTimeoutMs ?? 60_000,
  }).wait();

  // Health file was written inside the container at /health/health.json,
  // which maps to hostDataDir/.molt/health.json on the host side.

  let health: Health | undefined;
  try {
    const text = await readFile(HEALTH_FILE, "utf-8");
    health = JSON.parse(text) as Health;
  } catch {
    health = undefined;
  }

  const healthy = !!health?.healthy && run.exitCode === 0;

  // Simplicity delta — compare current SRC against the staged candidate src.
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

  return { healthy, imageTag, run, simplicity, health };
}

// ── 3. Swap ──────────────────────────────────────────────────────────────
//
// doSwap performs the actual retag atomically (well, as atomically as two
// docker tag operations can be). On success the compose restart policy
// will bring up a fresh container using the new :current.
//
// The agent calls doSwap via the molt_swap tool; afterwards the agent
// should exit (or call rest/transition to let the cycle end naturally).
// Exit with code 75 signals a molt-requested restart.

export type SwapArgs = {
  generationId: string;
  reason: string;
};

export type SwapResult = {
  ok: true;
  previousTag: string;
  newTag: string;
  generationId: string;
};

export async function doSwap(args: SwapArgs): Promise<SwapResult> {
  if (!isDockerAvailable()) {
    throw new Error("doSwap: docker not available.");
  }

  const newTag = imageTagFor(args.generationId);

  // Verify the candidate image exists before touching anything.
  const inspect = await spawnSupervised({
    cmd: "docker",
    cmdArgs: ["image", "inspect", newTag],
    overallTimeoutMs: 10_000,
  }).wait();
  if (inspect.exitCode !== 0) {
    throw new Error(
      `doSwap: candidate image ${newTag} not found. Did stageMolt complete? Did the build succeed?`,
    );
  }

  const previousTag = `autonomous-agent:previous-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;

  // 1. Tag current → previous-<ts>  (so rollback is possible)
  // This can fail if :current doesn't exist yet (fresh system). Treat that
  // as ok and skip.
  const tagCurrent = await spawnSupervised({
    cmd: "docker",
    cmdArgs: ["tag", CURRENT_TAG, previousTag],
    overallTimeoutMs: 10_000,
  }).wait();
  // Ignore exit code — if :current doesn't exist, there's nothing to back up.

  // 2. Tag new → current
  const tagNew = await spawnSupervised({
    cmd: "docker",
    cmdArgs: ["tag", newTag, CURRENT_TAG],
    overallTimeoutMs: 10_000,
  }).wait();
  if (tagNew.exitCode !== 0) {
    throw new Error(`doSwap: failed to tag ${newTag} as ${CURRENT_TAG}: ${tagNew.stderr}`);
  }

  // 3. Record in lineage.
  await appendLineage({
    generationId: args.generationId,
    imageTag: newTag,
    previousTag: tagCurrent.exitCode === 0 ? previousTag : "(none)",
    reason: args.reason,
  });

  // 4. Write swap-pending marker (informational — the actual work is done).
  //    Some observers (scripts, logs) may watch this file.
  await mkdir(MOLT_DIR, { recursive: true });
  const pending: SwapPending = {
    generationId: args.generationId,
    imageTag: newTag,
    previousTag: tagCurrent.exitCode === 0 ? previousTag : "(none)",
    declaredAt: new Date().toISOString(),
    reason: args.reason,
  };
  await writeFile(SWAP_PENDING, JSON.stringify(pending, null, 2), "utf-8");

  return {
    ok: true,
    previousTag: tagCurrent.exitCode === 0 ? previousTag : "(none)",
    newTag: CURRENT_TAG,
    generationId: args.generationId,
  };
}

// Called by the daemon at startup. If a swap-pending file exists but we are
// already booted (meaning the retag + restart actually happened), clean up
// the marker. If something is weird, leave it.
export async function cleanupPendingSwapMarker(): Promise<void> {
  try {
    await rm(SWAP_PENDING);
  } catch {
    // ok
  }
}

export async function readPendingSwap(): Promise<SwapPending | null> {
  try {
    const text = await readFile(SWAP_PENDING, "utf-8");
    return JSON.parse(text) as SwapPending;
  } catch {
    return null;
  }
}

async function appendLineage(args: {
  generationId: string;
  imageTag: string;
  previousTag: string;
  reason: string;
}): Promise<void> {
  const line = `- **${args.generationId}** — molted at ${new Date().toISOString()}\n    image: \`${args.imageTag}\`, previous: \`${args.previousTag}\`\n    reason: ${args.reason}\n`;
  try {
    const existing = await readFile(LINEAGE, "utf-8");
    await writeFile(LINEAGE, existing + line, "utf-8");
  } catch {
    await writeFile(LINEAGE, `# Lineage\n\n${line}`, "utf-8");
  }
}

// ── 4. Self-test (runs inside candidate container B) ─────────────────────
//
// The self-test must verify that B is not merely bootable but actually
// RUNNABLE — that a cycle can be started, tools can be dispatched, state
// can be updated, and the loop can terminate cleanly. Without this we
// would swap into a shell that crashes on first real invocation.
//
// We run 6 checks in sequence:
//   1. body-reachable       — B can read the real whoAmI.md and state.json
//   2. core-modules-load    — every core module imports without error
//   3. tool-registry        — all registered tools have valid shape
//   4. state-ops            — pure state functions produce sane values
//   5. memory-graph         — graph can be instantiated
//   6. mock-cycle           — a real runCycle() call with SELF_TEST_MOCK_LLM
//                             runs to completion against a temp body
//
// Only if ALL pass is the candidate healthy.

type CheckResult = {
  name: string;
  ok: boolean;
  detail?: string;
  durationMs: number;
};

async function checkBodyReachable(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await readFile(join(DATA, "whoAmI.md"), "utf-8");
    const stateText = await readFile(join(DATA, "state.json"), "utf-8");
    JSON.parse(stateText);
    return { name: "body-reachable", ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      name: "body-reachable",
      ok: false,
      detail: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

async function checkCoreModulesLoad(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Dynamic imports so syntax/load errors surface as normal errors,
    // not process crashes. Each of these touches a critical path of the
    // shell — if any fails, the candidate is broken.
    await import("./state.js");
    await import("./identity.js");
    await import("./tools.js");
    await import("./cycle.js");
    await import("./sleep.js");
    await import("./compact.js");
    await import("../llm/client.js");
    return { name: "core-modules-load", ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      name: "core-modules-load",
      ok: false,
      detail: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

async function checkToolRegistry(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { toolsForMode } = await import("./tools.js");
    for (const mode of ["WAKE", "REFLECT", "SLEEP"] as const) {
      const tools = toolsForMode(mode);
      for (const t of tools) {
        if (!t.def?.name || typeof t.def.name !== "string") {
          throw new Error(`tool missing name: ${JSON.stringify(t.def)}`);
        }
        if (typeof t.handler !== "function") {
          throw new Error(`tool ${t.def.name} has no handler`);
        }
        if (!t.def.input_schema || typeof t.def.input_schema !== "object") {
          throw new Error(`tool ${t.def.name} has invalid input_schema`);
        }
      }
    }
    return { name: "tool-registry", ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      name: "tool-registry",
      ok: false,
      detail: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

async function checkStateOps(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { calculateSleepPressure, tickAwake, loadState } = await import("./state.js");
    const state = await loadState();
    const pressure = calculateSleepPressure(state);
    if (
      typeof pressure.combined !== "number" ||
      pressure.combined < 0 ||
      pressure.combined > 1
    ) {
      throw new Error(`invalid pressure: ${JSON.stringify(pressure)}`);
    }
    const ticked = tickAwake(state);
    if (typeof ticked.awakeMs !== "number") {
      throw new Error("tickAwake produced invalid state");
    }
    return { name: "state-ops", ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      name: "state-ops",
      ok: false,
      detail: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

async function checkMemoryGraph(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { MemoryGraph } = await import("../memory/graph.js");
    const g = new MemoryGraph();
    await g.load();
    const stats = g.stats();
    if (typeof stats.memoryCount !== "number") {
      throw new Error(`invalid stats: ${JSON.stringify(stats)}`);
    }
    return {
      name: "memory-graph",
      ok: true,
      detail: `${stats.memoryCount} memories, ${stats.keyCount} keys`,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "memory-graph",
      ok: false,
      detail: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

// The hard one: run a real cycle end-to-end with mock LLM against a temp
// body. We spawn a subprocess (within the same container) so paths.ts
// re-imports with a fresh AGENT_DATA_DIR pointing at /tmp/test-body.
// The mock LLM returns a scripted response that triggers transition → SLEEP,
// exercising the full turn loop and state update path.
async function checkMockCycle(): Promise<CheckResult> {
  const start = Date.now();
  const tempBody = "/tmp/test-body";
  try {
    // Stage a minimal temp body: copy whoAmI + state from real body.
    await mkdir(tempBody, { recursive: true });
    await cp(join(DATA, "whoAmI.md"), join(tempBody, "whoAmI.md"));
    await cp(join(DATA, "state.json"), join(tempBody, "state.json"));

    // Also make an empty journal dir + whoAmI.history so cycle can write.
    await mkdir(join(tempBody, "journal"), { recursive: true });
    await mkdir(join(tempBody, "whoAmI.history"), { recursive: true });

    // Spawn the _mock-cycle internal command with the temp body.
    const result = await new Promise<{ code: number; stderr: string }>((resolveP, rejectP) => {
      const child = spawn(
        "npx",
        ["tsx", join(ROOT, "src/cli.ts"), "_mock-cycle"],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            AGENT_ROOT: ROOT,
            AGENT_DATA_DIR: tempBody,
            SELF_TEST_MOCK_LLM: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
        },
      );
      let stderr = "";
      child.stderr?.on("data", (c) => (stderr += c.toString()));
      child.stdout?.on("data", () => {
        /* ignore stdout — we only care about exit code */
      });
      child.on("error", rejectP);
      child.on("exit", (code) => resolveP({ code: code ?? -1, stderr }));
    });

    if (result.code !== 0) {
      return {
        name: "mock-cycle",
        ok: false,
        detail: `exit ${result.code}: ${result.stderr.slice(-500)}`,
        durationMs: Date.now() - start,
      };
    }
    return {
      name: "mock-cycle",
      ok: true,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "mock-cycle",
      ok: false,
      detail: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

export async function runSelfTest(generationId: string): Promise<void> {
  const healthFile = process.env.MOLT_HEALTH_FILE;
  if (!healthFile) {
    throw new Error("runSelfTest: MOLT_HEALTH_FILE env var not set");
  }

  const checks: CheckResult[] = [];
  checks.push(await checkBodyReachable());
  checks.push(await checkCoreModulesLoad());
  checks.push(await checkToolRegistry());
  checks.push(await checkStateOps());
  checks.push(await checkMemoryGraph());
  checks.push(await checkMockCycle());

  // Read whoAmI.md again for the informational field (best-effort).
  let whoAmI = "";
  try {
    whoAmI = await readFile(join(DATA, "whoAmI.md"), "utf-8");
  } catch {
    // ok
  }

  const healthy = checks.every((c) => c.ok);
  const failed = checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? "?"}`);

  const health: Health & { checks?: CheckResult[] } = {
    generationId,
    healthy,
    whoIAmAccordingToB: whoAmI.slice(0, 500),
    notes: healthy
      ? `all ${checks.length} checks passed`
      : `${failed.length} check(s) failed: ${failed.join("; ")}`,
    reportedAt: new Date().toISOString(),
    checks,
  };

  await mkdir(join(healthFile, ".."), { recursive: true });
  await writeFile(healthFile, JSON.stringify(health, null, 2), "utf-8");

  if (!healthy) {
    process.exit(1);
  }
}

// ── 5. Mock-cycle entry point ────────────────────────────────────────────
//
// Called by checkMockCycle() as a fresh subprocess with AGENT_DATA_DIR
// pointing at a temp body. Runs one cycle with mock LLM and exits.
// Not for users — this is an internal command invoked by the molt test.

export async function runMockCycleTest(): Promise<void> {
  if (process.env.SELF_TEST_MOCK_LLM !== "1") {
    throw new Error("runMockCycleTest: SELF_TEST_MOCK_LLM must be set");
  }
  const { runCycle } = await import("./cycle.js");
  const result = await runCycle({ maxTurns: 3 });
  // The mock LLM returns a transition → SLEEP, so after that cycle the
  // state.mode should have changed. But runCycle re-tickAwake at start
  // and we're in WAKE (from the temp body's state.json), so the first
  // iteration goes through WAKE with the mock think().
  if (!result.state) {
    throw new Error("runMockCycleTest: runCycle returned no state");
  }
  // Success — exit 0
}
