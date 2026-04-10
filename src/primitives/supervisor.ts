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
  // Path to a script inside the agent's world. Validated against ROOT.
  script: string;
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

export function spawnSupervised(input: SpawnInput): ManagedRun {
  const scriptAbs = resolve(ROOT, input.script);
  const rel = relative(ROOT, scriptAbs);
  if (rel.startsWith("..")) {
    throw new Error(`spawn: script outside of self: ${input.script}`);
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

  // Spawn the child via tsx so source files run directly.
  const child: ChildProcess = spawn(
    "npx",
    ["tsx", scriptAbs, ...(input.args ?? [])],
    {
      cwd: input.cwd ?? ROOT,
      env: { ...process.env, ...input.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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
