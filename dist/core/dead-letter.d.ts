export type FailedEntry = {
    id: string;
    tool: string;
    input: Record<string, unknown>;
    error: string;
    ts: string;
};
export declare function enqueueFailed(entry: Omit<FailedEntry, "id">): Promise<void>;
export declare function peekDeadLetter(limit?: number): Promise<FailedEntry[]>;
export declare function clearDeadLetterEntry(id: string): Promise<boolean>;
