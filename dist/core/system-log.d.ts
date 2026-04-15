export type SystemLogEntry = {
    ts: string;
    event: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
    before?: number;
    after?: number;
    summarizedCount?: number;
    cycle?: number;
    mode?: string;
    reason?: string;
    error?: string;
    detail?: string;
};
export declare function resetSystemLogDay(): void;
export declare function logSystem(entry: SystemLogEntry): Promise<void>;
