---
name: shell-memory-management-loop
description: Manage working memory during iterative shell-based task execution, especially when alternating between command execution and state updates.
schedule: always
mode: WAKE
---

## Process
1. Use `shell` to inspect, run, or verify the current task step.
2. Immediately use `memory_manage` to record key outcomes, constraints, next actions, or state changes.
3. Before the next `shell` action, review the latest memory entries to ensure continuity and avoid repeating work.
4. If a file is created or modified with `write_file`, follow it with `memory_manage` to capture what changed and why.
5. Repeat the loop throughout the task, keeping memory synchronized with shell activity.