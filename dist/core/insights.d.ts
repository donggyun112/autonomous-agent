export type InsightReport = {
    totalCalls: number;
    errors: number;
    errorRate: number;
    avgDurationMs: number;
    topTools: Array<{
        tool: string;
        count: number;
    }>;
    journalDays: number;
    trend: "growing" | "stable" | "declining";
};
export declare function generateInsights(days?: number): Promise<InsightReport>;
