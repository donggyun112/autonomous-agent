export type ExecResult = {
    stdout: string;
    stderr: string;
    exitCode: number | null;
};
export declare function execScript(args: {
    script: string;
    args?: string[];
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
}): Promise<ExecResult>;
