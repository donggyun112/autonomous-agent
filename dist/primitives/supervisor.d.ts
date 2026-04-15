export type RunState = "starting" | "running" | "exiting" | "exited";
export type TerminationReason = "manual-cancel" | "overall-timeout" | "no-output-timeout" | "spawn-error" | "signal" | "exit";
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
    script?: string;
    cmd?: string;
    cmdArgs?: string[];
    args?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    overallTimeoutMs?: number;
    noOutputTimeoutMs?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
};
export type ManagedRun = {
    runId: string;
    record: () => RunRecord;
    wait: () => Promise<RunResult>;
    cancel: (reason?: TerminationReason) => void;
};
export declare function isDockerAvailable(): boolean;
export declare function spawnSupervised(input: SpawnInput): ManagedRun;
