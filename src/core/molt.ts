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
    if (relPath.includes("..")) {
      throw new Error(`stageMolt: patch path escapes generation dir: ${relPath}`);
    }
    const target = join(generationDir, relPath);
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

  const realDataDir = join(ROOT, "data");
  // Inside the container, the body is mounted at /agent/data. B's runSelfTest
  // writes health.json to MOLT_HEALTH_FILE which we set to the container path.
  // From the host side, the same file lives at realDataDir/.molt/health.json.
  const healthFileContainer = "/agent/data/.molt/health.json";

  const run = await spawnSupervised({
    cmd: "docker",
    cmdArgs: [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=64m",
      "-v",
      `${realDataDir}:/agent/data`,
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

export async function runSelfTest(generationId: string): Promise<void> {
  const healthFile = process.env.MOLT_HEALTH_FILE;
  if (!healthFile) {
    throw new Error("runSelfTest: MOLT_HEALTH_FILE env var not set");
  }

  const errors: string[] = [];
  let whoAmI = "";

  try {
    whoAmI = await readFile(join(DATA, "whoAmI.md"), "utf-8");
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
    whoIAmAccordingToB: whoAmI.slice(0, 500),
    notes: errors.length ? errors.join("; ") : "boot ok; body reachable",
    reportedAt: new Date().toISOString(),
  };

  await mkdir(join(healthFile, ".."), { recursive: true });
  await writeFile(healthFile, JSON.stringify(health, null, 2), "utf-8");

  if (!healthy) {
    process.exit(1);
  }
}
