---
name: file-iteration-and-context-refresh
description: Use when working on a file-based task that requires drafting, verifying, and refreshing local context from recent journal entries.
schedule: always
mode: WAKE
---

## Process
1. Start with a brief todo to frame the current file task and desired outcome.
2. Draft or update the target content with `write_file`.
3. Immediately verify the result with `read` to catch formatting or content issues early.
4. Before continuing after a context gap, use `read` followed by `recall_recent_journal` to refresh the working state and avoid drifting from prior decisions.
5. Repeat the write→read cycle until the file is stable and consistent with the task goal.