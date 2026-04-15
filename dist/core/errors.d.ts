export type ErrorCategory = "auth" | "rate_limit" | "context_overflow" | "network" | "filesystem" | "unknown";
export type RecoveryHint = {
    retryable: boolean;
    should_compress: boolean;
    should_rotate_credential: boolean;
};
export type ClassifiedError = {
    category: ErrorCategory;
    recovery: RecoveryHint;
    original: unknown;
    message: string;
};
export declare function classifyError(err: unknown): ClassifiedError;
