---
name: file-memory-task-iteration
description: Manage task state by iterating between memory updates, TODO tracking, and file writes/reads to keep work synchronized across turns and artifacts.
schedule: always
mode: WAKE
---

## Process
1. Use `todo` to capture or update the current actionable item before making changes.
2. Use `memory_manage` to record any durable state, decisions, or important context that should persist beyond the immediate step.
3. Use `write_file` to make the intended change or create the artifact.
4. Immediately use `read` to verify the file contents and confirm the write succeeded.
5. Repeat `memory_manage` after each meaningful update to keep memory aligned with the latest file/task state.
6. Continue alternating `todo` and `write_file` as work progresses, using memory updates to preserve the latest plan, status, and outcomes.