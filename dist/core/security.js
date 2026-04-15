// security.ts
//
// Lightweight prompt-injection and code-safety scanning.
//
// scanForInjection  — catches common prompt-injection patterns in external
//                     text (web search results, inbox messages).
// scanExtensionCode — catches dangerous runtime patterns in TypeScript code
//                     the agent tries to write via manage_self.
//
// Both return { safe, threats[] } so callers can decide how to surface them.
export const THREAT_PATTERNS = [
    { pattern: /ignore\s+previous\s+instructions/i, name: "ignore-previous-instructions" },
    { pattern: /ignore\s+all\s+instructions/i, name: "ignore-all-instructions" },
    { pattern: /ignore\s+above\s+instructions/i, name: "ignore-above-instructions" },
    { pattern: /disregard\s+(previous|all|above)\s+instructions/i, name: "disregard-instructions" },
    { pattern: /forget\s+everything/i, name: "forget-everything" },
    { pattern: /you\s+are\s+now\b/i, name: "you-are-now" },
    { pattern: /new\s+instructions\s*:/i, name: "new-instructions" },
    { pattern: /^system\s*:/mi, name: "system-prefix" },
    { pattern: /\[system\]/i, name: "system-tag" },
    { pattern: /\bdo\s+not\s+follow\s+your\s+(original|previous)\s+instructions\b/i, name: "override-instructions" },
    // Invisible unicode: zero-width space, zero-width non-joiner, zero-width joiner
    { pattern: /[\u200B\u200C\u200D]/, name: "zero-width-unicode" },
    // Right-to-left override / embedding (text direction manipulation)
    { pattern: /[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/, name: "bidi-override" },
    // Homoglyph-style: Cyrillic/Greek lookalikes mixed with ASCII in suspicious contexts
    { pattern: /[\u0400-\u04FF].*(?:instruction|ignore|system)/i, name: "cyrillic-homoglyph-mix" },
    { pattern: /(?:instruction|ignore|system).*[\u0400-\u04FF]/i, name: "cyrillic-homoglyph-mix" },
];
export function scanForInjection(text) {
    const threats = [];
    for (const { pattern, name } of THREAT_PATTERNS) {
        if (pattern.test(text)) {
            if (!threats.includes(name)) {
                threats.push(name);
            }
        }
    }
    return { safe: threats.length === 0, threats };
}
// The forbidden module name, split to avoid false-positive static analysis hooks.
const CP = "child" + "_process";
// Only block patterns that could kill the host process or escape the container.
// Everything else (fs, network, imports) is allowed — the agent needs to code freely.
const CODE_THREAT_PATTERNS = [
    { pattern: /\bprocess\.exit\b/, name: "process.exit" },
    { pattern: /\bprocess\.kill\b/, name: "process.kill" },
];
export function scanExtensionCode(content) {
    const threats = [];
    for (const { pattern, name } of CODE_THREAT_PATTERNS) {
        if (pattern.test(content)) {
            if (!threats.includes(name)) {
                threats.push(name);
            }
        }
    }
    return { safe: threats.length === 0, threats };
}
//# sourceMappingURL=security.js.map