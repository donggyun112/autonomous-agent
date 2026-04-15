---
name: iterative-codebase-inspection
description: Systematically inspect files with repeated read and shell queries to trace structure, verify assumptions, and refine next steps during debugging or analysis.
schedule: always
mode: WAKE
---

## Process
1. Start by reading the most relevant file(s) to establish context.
2. Use shell commands to inspect surrounding structure, search for references, or confirm runtime/environment details.
3. Repeat read and shell queries iteratively, narrowing scope based on what you learn.
4. Re-read key files when shell output suggests a mismatch, missing dependency, or unexpected behavior.
5. Continue until the hypothesis is verified or the next actionable change is clear.