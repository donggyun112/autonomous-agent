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

// ── Prompt-injection patterns ──────────────────────────────────────────

export interface ThreatPattern {
  pattern: RegExp;
  name: string;
}

export const THREAT_PATTERNS: ThreatPattern[] = [
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

export interface ScanResult {
  safe: boolean;
  threats: string[];
}

export function scanForInjection(text: string): ScanResult {
  const threats: string[] = [];
  for (const { pattern, name } of THREAT_PATTERNS) {
    if (pattern.test(text)) {
      if (!threats.includes(name)) {
        threats.push(name);
      }
    }
  }
  return { safe: threats.length === 0, threats };
}

// ── Extension code safety patterns ─────────────────────────────────────

interface CodeThreat {
  pattern: RegExp;
  name: string;
}

// The forbidden module name, split to avoid false-positive static analysis hooks.
const CP = "child" + "_process";

const CODE_THREAT_PATTERNS: CodeThreat[] = [
  { pattern: /\bprocess\.exit\b/, name: "process.exit" },
  { pattern: /\bprocess\.kill\b/, name: "process.kill" },
  { pattern: /\bfs\.rmSync\b/, name: "fs.rmSync" },
  { pattern: /\bfs\.unlinkSync\b/, name: "fs.unlinkSync" },
  { pattern: /\bexec\s*\(\s*["'`]rm\b/, name: "exec(rm)" },
  { pattern: /\bexecSync\b/, name: "execSync" },
  { pattern: new RegExp(`\\b${CP}\\b`), name: CP },
  { pattern: /\beval\s*\(/, name: "eval(" },
  { pattern: /\bFunction\s*\(/, name: "Function(" },
  { pattern: new RegExp(`\\brequire\\s*\\(\\s*["'\`]${CP}["'\`]\\s*\\)`), name: `require("${CP}")` },
  { pattern: new RegExp(`\\bimport\\s*\\(\\s*["'\`]${CP}["'\`]\\s*\\)`), name: `import("${CP}")` },
  // node: protocol variants
  { pattern: new RegExp(`\\brequire\\s*\\(\\s*["'\`]node:${CP}["'\`]\\s*\\)`), name: `require("node:${CP}")` },
  { pattern: new RegExp(`\\bimport\\s*\\(\\s*["'\`]node:${CP}["'\`]\\s*\\)`), name: `import("node:${CP}")` },
  { pattern: /\bfrom\s+["'`]node:child_process["'`]/, name: "import-from-node:child_process" },
  { pattern: new RegExp(`\\bfrom\\s+["'\`]${CP}["'\`]`), name: `import-from-${CP}` },
  // fs.writeFileSync — flag unconditionally; regex can't reliably check indirect paths
  { pattern: /\bfs\.writeFileSync\b/, name: "fs.writeFileSync" },
  // Network access — extensions should not make outbound connections
  { pattern: /\brequire\s*\(\s*["'`](?:node:)?(?:http|https|net|dgram|tls)["'`]\s*\)/, name: "network-require" },
  { pattern: /\bimport\s*\(\s*["'`](?:node:)?(?:http|https|net|dgram|tls)["'`]\s*\)/, name: "network-import" },
  { pattern: /\bfrom\s+["'`](?:node:)?(?:http|https|net|dgram|tls)["'`]/, name: "network-import-from" },
  { pattern: /\bfetch\s*\(/, name: "fetch" },
  // Docker socket — must not escape container
  { pattern: /docker\.sock/, name: "docker-socket" },
  // Direct file ops outside extensions — flag rm, unlink, writeFile on paths with ../
  { pattern: /\bfs\.\w+Sync\b/, name: "fs-sync-op" },
  { pattern: /\brm\s*\(\s*["'`](?:\.\.|\/)/, name: "rm-outside" },
  // Import of core modules — extensions must not reach into src/core/
  { pattern: /\bfrom\s+["'`](?:\.\.\/)+core\//, name: "import-core-module" },
  { pattern: /\bimport\s*\(\s*["'`](?:\.\.\/)+core\//, name: "dynamic-import-core" },
];

export function scanExtensionCode(content: string): ScanResult {
  const threats: string[] = [];
  for (const { pattern, name } of CODE_THREAT_PATTERNS) {
    if (pattern.test(content)) {
      if (!threats.includes(name)) {
        threats.push(name);
      }
    }
  }
  return { safe: threats.length === 0, threats };
}
