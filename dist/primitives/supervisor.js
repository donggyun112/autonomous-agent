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
import { spawn } from "child_process";
import { resolve, relative } from "path";
import { ROOT } from "./paths.js";
// NOTE: execSync is used only for isDockerAvailable() which is a cheap
// capability probe, not for actual execution.
import { execSync } from "child_process";
let _runIdCounter = 0;
function nextRunId() {
    return `run-${Date.now()}-${++_runIdCounter}`;
}
// Probe whether `docker` is callable. Cheap — `docker version` exits fast if
// the daemon is reachable, otherwise quickly errors. Cached so we don't
// re-probe every molt test.
let _dockerAvailable = null;
export function isDockerAvailable() {
    if (_dockerAvailable !== null)
        return _dockerAvailable;
    try {
        execSync("docker version --format '{{.Server.Version}}'", {
            stdio: "ignore",
            timeout: 3000,
        });
        _dockerAvailable = true;
    }
    catch {
        _dockerAvailable = false;
    }
    return _dockerAvailable;
}
export function spawnSupervised(input) {
    // Resolve the command. Two modes:
    //   1. script mode: run `npx tsx <script>` inside ROOT (legacy)
    //   2. cmd mode: run arbitrary `<cmd> <args>` (used by docker-based molt test)
    let command;
    let cmdArgs;
    if (input.cmd) {
        command = input.cmd;
        cmdArgs = input.cmdArgs ?? [];
    }
    else if (input.script) {
        const scriptAbs = resolve(ROOT, input.script);
        const rel = relative(ROOT, scriptAbs);
        if (rel.startsWith("..")) {
            throw new Error(`spawn: script outside of self: ${input.script}`);
        }
        command = "npx";
        cmdArgs = ["tsx", scriptAbs, ...(input.args ?? [])];
    }
    else {
        throw new Error("spawn: must provide either `script` or `cmd`");
    }
    const runId = nextRunId();
    const startedAtMs = Date.now();
    const record = {
        runId,
        state: "starting",
        startedAtMs,
        lastOutputAtMs: startedAtMs,
        exitCode: null,
        exitSignal: null,
    };
    let settled = false;
    let forcedReason = null;
    let stdout = "";
    let stderr = "";
    let overallTimer = null;
    let noOutputTimer = null;
    const child = spawn(command, cmdArgs, {
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
    const setForcedReason = (reason) => {
        if (forcedReason)
            return;
        forcedReason = reason;
        record.state = "exiting";
        record.terminationReason = reason;
    };
    const requestCancel = (reason) => {
        if (settled)
            return;
        setForcedReason(reason);
        try {
            child.kill("SIGKILL");
        }
        catch {
            // already gone
        }
        // P1-4 fix: when the supervised process is `docker run`, killing the
        // local docker CLI does NOT immediately kill the container. We find
        // the container name from --name arg and fire-and-forget `docker stop`.
        if (command === "docker" && cmdArgs[0] === "run") {
            const nameIdx = cmdArgs.indexOf("--name");
            const containerName = nameIdx >= 0 ? cmdArgs[nameIdx + 1] : undefined;
            if (containerName) {
                try {
                    spawn("docker", ["stop", "-t", "3", containerName], {
                        stdio: "ignore",
                        detached: true,
                    }).unref();
                }
                catch {
                    // best effort
                }
            }
        }
    };
    const touchOutput = () => {
        record.lastOutputAtMs = Date.now();
        if (!input.noOutputTimeoutMs || settled)
            return;
        if (noOutputTimer)
            clearTimeout(noOutputTimer);
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
    child.stdout?.on("data", (chunk) => {
        const s = chunk.toString();
        stdout += s;
        input.onStdout?.(s);
        touchOutput();
    });
    child.stderr?.on("data", (chunk) => {
        const s = chunk.toString();
        stderr += s;
        input.onStderr?.(s);
        touchOutput();
    });
    const waitPromise = new Promise((resolveP) => {
        const finalize = (reason, code, signal) => {
            if (settled)
                return;
            settled = true;
            clearTimers();
            record.state = "exited";
            record.exitCode = code;
            record.exitSignal = signal;
            if (!record.terminationReason)
                record.terminationReason = reason;
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
            const reason = forcedReason ?? (signal != null ? "signal" : "exit");
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
//# sourceMappingURL=supervisor.js.map