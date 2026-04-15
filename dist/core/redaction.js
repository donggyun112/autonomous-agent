// PII/sensitive data redaction — strips patterns before memory storage.
const PATTERNS = [
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, name: "email" },
    { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, name: "phone" },
    { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, name: "credit-card" },
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, name: "ssn" },
    { pattern: /\b(?:sk-ant-|sk-proj-|ghp_|gho_|github_pat_|xoxb-|xoxp-|AKIA)[A-Za-z0-9_-]{10,}/g, name: "api-key" },
    { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, name: "ip-address" },
    { pattern: /https?:\/\/[^\s]*(?:token|key|secret|password|auth)=[^\s&]*/gi, name: "url-with-token" },
];
export function redact(text) {
    let result = text;
    const found = [];
    for (const { pattern, name } of PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(result)) {
            found.push(name);
            pattern.lastIndex = 0;
            result = result.replace(pattern, `[REDACTED:${name}]`);
        }
    }
    return { text: result, redacted: found.length > 0, patterns: found };
}
//# sourceMappingURL=redaction.js.map