export type CycleScore = {
    day: number;
    score: number;
    ts: string;
};
export declare function scoreCycle(report: {
    toolCalls: number;
    errors: number;
    uniqueTools: number;
    totalTurns: number;
}): number;
export declare function recordScore(day: number, score: number): Promise<void>;
export declare function getScoreTrend(lastN?: number): Promise<{
    scores: CycleScore[];
    trend: "improving" | "stable" | "declining";
}>;
