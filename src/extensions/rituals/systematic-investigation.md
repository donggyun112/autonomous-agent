---
name: systematic-investigation
description: When exploring an unfamiliar codebase, debugging an issue, or gathering context across multiple files — read broadly first, then execute and verify iteratively.
schedule: always
mode: WAKE
---

## Process
1. **Read broadly** — open and read multiple related files in sequence (read→read) to build a mental map of the area before acting.
2. **Track findings** — use `todo` to capture questions, hypotheses, and discovered relationships as you go.
3. **Execute in batches** — run shell commands in sequence (shell→shell) to test, query, or transform; chain related commands rather than alternating back to reads.
4. **Verify after executing** — after a shell command, read the relevant output or file (shell→read) to confirm the result matches expectations.
5. **Persist key context** — store confirmed facts and structural insights into memory via `memory_manage` so future sessions skip re-discovery.
6. **Recall before re-investigating** —