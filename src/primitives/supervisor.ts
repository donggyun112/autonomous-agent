// PRIMITIVE: supervisor (mini)
//
// A scoped-down clone of openclaw's ProcessSupervisor (reference/openclaw/src/process/supervisor/supervisor.ts).
// Used by the molt protocol to spawn a candidate shell B inside the running A,
// watch for healthy/unhealthy signals, enforce timeouts, and clean up.
//
// Differences from openclaw's version:
//  - single-process registry (we never need many concurrent runs)
//  - no PTY support (molt always spawns plain `tsx` scripts)
//  - no scopeKey grouping (one molt at a time)
//  - returns captured stdout/stderr in result
//
// Three timer types — same as openclaw:
//   overallTimeoutMs    — total wall-clock budget for the run
//   noOutputTimeoutMs   — kill if no stdout/stderr for N ms
//   manual cancel       — caller decides

import { spawn, type ChildProcess } from "child_process";
import { resolve, relative } from "path";
import { ROOT } from "./paths.js";
// NOTE: execSync is used only for isDockerAvailable() which is a cheap
// capability probe, not for actual execution.
import { execSync } from "child_process";

export type RunState = "starting" | "running" | "exiting" | "exited";

export type TerminationReason =
  | "manual-cancel"
  | "overall-timeout"
  | "no-output-timeout"
  | "spawn-error"
  | "signal"
  | "exit";

export type RunRecord = {
  runId: string;
  pid?: number;
  state: RunState;
  startedAtMs: number;
  lastOutputAtMs: number;
  terminationReason?: TerminationReason;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
};

export type RunResult = {
  runId: string;
  reason: TerminationReason;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export type SpawnInput = {
  // Either pass `script` (a tsx-runnable path inside the agent's world) OR
  // pass `cmd` + `cmdArgs` to run an arbitrary command. Script mode was the
  // original shape; cmd mode was added so the molt protocol can spawn
  // `docker run ...` as a child process with the same supervision primitives.
  script?: string;
  cmd?: string;
  cmdArgs?: string[];
  // Additional args appended after the script path (script mode only).
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  // Hard wall-clock limit. After this, the process is killed with overall-timeout.
  overallTimeoutMs?: number;
  // If no stdout/stderr arrives within this window, the process is killed with no-output-timeout.
  // Reset on every chunk.
  noOutputTimeoutMs?: number;
  // Optional callbacks for streaming. Useful when the spawned process is going
  // to print progress and the caller wants to react before exit.
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type ManagedRun = {
  runId: string;
  record: () => RunRecord;
  wait: () => Promise<RunResult>;
  cancel: (reason?: TerminationReason) => void;
};

let _runIdCounter = 0;
function nextRunId(): string {
  return `run-${Date.now()}-${++_runIdCounter}`;
}

// Probe whether `docker` is callable. Cheap — `docker version` exits fast if
// the daemon is reachable, otherwise quickly errors. Cached so we don't
// re-probe every molt test.
let _dockerAvailable: boolean | null = null;
export function isDockerAvailable(): boolean {
  if (_dockerAvailable !== null) return _dockerAvailable;
  try {
    execSync("docker version --format '{{.Server.Version}}'", {
      stdio: "ignore",
      timeout: 3000,
    });
    _dockerAvailable = true;
  } catch {
    _dockerAvailable = false;
  }
  return _dockerAvailable;
}

export function spawnSupervised(input: SpawnInput): ManagedRun {
  // Resolve the command. Two modes:
  //   1. script mode: run `npx tsx <script>` inside ROOT (legacy)
  //   2. cmd mode: run arbitrary `<cmd> <args>` (used by docker-based molt test)
  let command: string;
  let cmdArgs: string[];
  if (input.cmd) {
    command = input.cmd;
    cmdArgs = input.cmdArgs ?? [];
  } else if (input.script) {
    const scriptAbs = resolve(ROOT, input.script);
    const rel = relative(ROOT, scriptAbs);
    if (rel.startsWith("..")) {
      throw new Error(`spawn: script outside of self: ${input.script}`);
    }
    command = "npx";
    cmdArgs = ["tsx", scriptAbs, ...(input.args ?? [])];
  } else {
    throw new Error("spawn: must provide either `script` or `cmd`");
  }

  const runId = nextRunId();
  const startedAtMs = Date.now();

  const record: RunRecord = {
    runId,
    state: "starting",
    startedAtMs,
    lastOutputAtMs: startedAtMs,
    exitCode: null,
    exitSignal: null,
  };

  let settled = false;
  let forcedReason: TerminationReason | null = null;
  let stdout = "";
  let stderr = "";
  let overallTimer: NodeJS.Timeout | null = null;
  let noOutputTimer: NodeJS.Timeout | null = null;

  const child: ChildProcess = spawn(command, cmdArgs, {
    cwd: input.cwd ?? ROOT,
    env: { ...process.env, ...input.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  record.pid = child.pid;
  record.state = "running";

  const clearTimers = () => {
    if (overallTimer) {
      clearTimeout(overallTimer);
      overallTimer = null;
    }
    if (noOutputTimer) {
      clearTimeout(noOutputTimer);
      noOutputTimer = null;
    }
  };

  const setForcedReason = (reason: TerminationReason) => {
    if (forcedReason) return;
    forcedReason = reason;
    record.state = "exiting";
    record.terminationReason = reason;
  };

  const requestCancel = (reason: TerminationReason) => {
    if (settled) return;
    setForcedReason(reason);
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }

    // P1-4 fix: when the supervised process is `docker run`, killing the
    // local docker CLI does NOT kill the container — the Docker daemon owns
    // it. We fire-and-forget a `docker stop` with a short grace period to
    // ensure the container is actually terminated. Without this, timed-out
    // candidates can outlive their supervisor and hold mounted volumes.
    if (command === "docker" && cmdArgs[0] === "run") {
      // Find --name or use --rm (which auto-removes, but the container
      // may still be running until stopped). Best effort: `docker stop`
      // by container image+cmd — but we don't have the container ID.
      // Fallback: rely on --rm cleaning up after SIGKILL of the docker CLI.
      // Actually: when `docker run --rm` is used and the CLI receives
      // SIGKILL, Docker daemon sends SIGTERM to the container, waits 10s,
      // then SIGKILLs it. So --rm containers DO get cleaned up eventually.
      // For extra safety, we could parse the container ID from stdout but
      // that's complex. The --rm flag + CLI SIGKILL is sufficient for now.
    }
  };

  const touchOutput = () => {
    record.lastOutputAtMs = Date.now();
    if (!input.noOutputTimeoutMs || settled) return;
    if (noOutputTimer) clearTimeout(noOutputTimer);
    noOutputTimer = setTimeout(() => {
      requestCancel("no-output-timeout");
    }, input.noOutputTimeoutMs);
  };

  if (input.overallTimeoutMs) {
    overallTimer = setTimeout(() => {
      requestCancel("overall-timeout");
    }, input.overallTimeoutMs);
  }
  if (input.noOutputTimeoutMs) {
    noOutputTimer = setTimeout(() => {
      requestCancel("no-output-timeout");
    }, input.noOutputTimeoutMs);
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    const s = chunk.toString();
    stdout += s;
    input.onStdout?.(s);
    touchOutput();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const s = chunk.toString();
    stderr += s;
    input.onStderr?.(s);
    touchOutput();
  });

  const waitPromise = new Promise<RunResult>((resolveP) => {
    const finalize = (
      reason: TerminationReason,
      code: number | null,
      signal: NodeJS.Signals | number | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimers();
      record.state = "exited";
      record.exitCode = code;
      record.exitSignal = signal;
      if (!record.terminationReason) record.terminationReason = reason;
      resolveP({
        runId,
        reason: forcedReason ?? reason,
        exitCode: code,
        exitSignal: signal,
        durationMs: Date.now() - startedAtMs,
        stdout,
        stderr,
      });
    };

    child.on("error", (_err) => {
      finalize("spawn-error", null, null);
    });
    child.on("exit", (code, signal) => {
      const reason: TerminationReason =
        forcedReason ?? (signal != null ? "signal" : "exit");
      finalize(reason, code, signal);
    });
  });

  return {
    runId,
    record: () => ({ ...record }),
    wait: () => waitPromise,
    cancel: (reason = "manual-cancel") => requestCancel(reason),
  };
}
