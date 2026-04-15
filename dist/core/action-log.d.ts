export type ActionEntry = {
    ts: string;
    cycle: number;
    mode: string;
    tool: string;
    input_summary: string;
    output_summary: string;
    duration_ms: number;
    error?: string;
};
export declare function resetActionLogDay(): void;
export declare function logAction(entry: ActionEntry): Promise<void>;
export declare function readRecentActions(days?: number): Promise<ActionEntry[]>;
export declare function actionStats(days?: number): Promise<{
    totalCalls: number;
    byTool: Record<string, number>;
    errors: number;
    avgDurationMs: number;
}>;
export type CycleCostEntry = {
    ts: string;
    cycle: number;
    mode: string;
    inputTokens: number;
    outputTokens: number;
};
export declare function logCycleCost(entry: CycleCostEntry): Promise<void>;
export declare function moltStats(): Promise<{
    totalMolts: number;
    failedMolts: number;
    successRate: number;
}>;
