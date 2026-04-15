---
name: shell-memory-read-reconciliation
description: Use when repeated shell, memory management, and read operations indicate a structured cycle for inspecting system state, updating working memory, and verifying results.
schedule: always
mode: WAKE
---

## Process
1. Use `shell` to inspect the current state, run the needed command, or gather output relevant to the task.
2. Use `read` to review the produced files, logs, or command output for confirmation and missing details.
3. Use `memory_manage` to record the important findings, decisions, or next steps so the workflow can resume reliably.
4. Repeat the `shell -> read -> memory_manage` cycle as needed until the state is verified and the task is complete.