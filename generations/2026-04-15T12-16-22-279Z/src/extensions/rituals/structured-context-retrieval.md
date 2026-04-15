---
name: structured-context-retrieval
description: Efficiently refresh working context by combining reading, inbox checks, and memory management when starting or resuming a task with stale or fragmented information.
schedule: always
mode: WAKE
---

## Process
1. Begin by reading the most relevant current context to re-orient on the task.
2. If there may be new user updates or pending messages, check the inbox before proceeding.
3. Use memory management to surface or consolidate relevant long-term facts when the current context seems incomplete.
4. Re-read key sources after inbox or memory updates to confirm the latest state.
5. Repeat the read/check/memory cycle only as needed until the task state is clear, then continue with execution.