// Centralized error classification for the autonomous agent.
//
// Many catch blocks in the codebase silently swallow errors, making failures
// invisible. This module provides a lightweight classifier that categorizes
// errors by type and suggests recovery actions. Call classifyError(err) in
// any catch block to get structured information about what went wrong and
// what the caller can do about it.
// Extract a human-readable message from any thrown value.
function extractMessage(err) {
    if (err instanceof Error)
        return err.message;
    if (typeof err === "string")
        return err;
    try {
        return JSON.stringify(err);
    }
    catch {
        return String(err);
    }
}
// Extract an HTTP status code from common error shapes (Anthropic SDK errors,
// fetch errors, etc.). Returns undefined if no status can be found.
function extractStatus(err) {
    if (err && typeof err === "object") {
        const obj = err;
        if (typeof obj.status === "number")
            return obj.status;
        if (typeof obj.statusCode === "number")
            return obj.statusCode;
        if (obj.error && typeof obj.error === "object") {
            const inner = obj.error;
            if (typeof inner.status === "number")
                return inner.status;
        }
    }
    return undefined;
}
export function classifyError(err) {
    const message = extractMessage(err);
    const status = extractStatus(err);
    const lower = message.toLowerCase();
    // Auth errors: 401, 403, or messages mentioning auth/key/permission.
    if (status === 401 ||
        status === 403 ||
        lower.includes("unauthorized") ||
        lower.includes("forbidden") ||
        lower.includes("invalid api key") ||
        lower.includes("invalid x-api-key") ||
        lower.includes("permission denied") ||
        lower.includes("authentication")) {
        return {
            category: "auth",
            recovery: { retryable: false, should_compress: false, should_rotate_credential: true },
            original: err,
            message,
        };
    }
    // Rate limit: 429 or messages mentioning rate/limit/throttle.
    if (status === 429 ||
        lower.includes("rate limit") ||
        lower.includes("rate_limit") ||
        lower.includes("too many requests") ||
        lower.includes("throttl")) {
        return {
            category: "rate_limit",
            recovery: { retryable: true, should_compress: false, should_rotate_credential: false },
            original: err,
            message,
        };
    }
    // Context overflow: messages about token limits or context length.
    if ((lower.includes("context") && lower.includes("length")) ||
        lower.includes("too many tokens") ||
        lower.includes("max_tokens") ||
        lower.includes("context window") ||
        lower.includes("token limit") ||
        lower.includes("prompt is too long")) {
        return {
            category: "context_overflow",
            recovery: { retryable: false, should_compress: true, should_rotate_credential: false },
            original: err,
            message,
        };
    }
    // Network errors: connection refused, timeout, DNS, fetch failures.
    if (status === 502 ||
        status === 503 ||
        status === 504 ||
        lower.includes("econnrefused") ||
        lower.includes("econnreset") ||
        lower.includes("etimedout") ||
        lower.includes("enotfound") ||
        lower.includes("fetch failed") ||
        lower.includes("network") ||
        lower.includes("socket hang up") ||
        (lower.includes("connection") && lower.includes("error")) ||
        lower.includes("request timeout") ||
        lower.includes("connect timeout") ||
        lower.includes("etimedout") ||
        lower.includes("overloaded")) {
        return {
            category: "network",
            recovery: { retryable: true, should_compress: false, should_rotate_credential: false },
            original: err,
            message,
        };
    }
    // Filesystem errors.
    if (lower.includes("enoent") ||
        lower.includes("eacces") ||
        lower.includes("eisdir") ||
        lower.includes("enospc") ||
        lower.includes("no such file") ||
        lower.includes("file not found")) {
        return {
            category: "filesystem",
            recovery: { retryable: false, should_compress: false, should_rotate_credential: false },
            original: err,
            message,
        };
    }
    // Server errors (500, 529) are retryable.
    if (status !== undefined && status >= 500) {
        return {
            category: "network",
            recovery: { retryable: true, should_compress: false, should_rotate_credential: false },
            original: err,
            message,
        };
    }
    // Unknown / unrecognised.
    return {
        category: "unknown",
        recovery: { retryable: false, should_compress: false, should_rotate_credential: false },
        original: err,
        message,
    };
}
//# sourceMappingURL=errors.js.map