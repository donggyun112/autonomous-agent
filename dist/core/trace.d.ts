export type TraceSpan = {
    id: string;
    name: string;
    parent?: string;
    startMs: number;
    endMs?: number;
    metadata?: Record<string, unknown>;
};
export declare function startSpan(name: string, parent?: string): string;
export declare function endSpan(id: string, metadata?: Record<string, unknown>): void;
export declare function getTrace(): TraceSpan[];
export declare function resetTrace(): void;
export declare function saveTrace(day: number, cycle: number): Promise<void>;
