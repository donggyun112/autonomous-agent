---
name: stateful-task-capture-and-implementation
description: Capture work in memory, convert it into actionable todos, implement by reading context and writing files, then log progress back to journal. Use when a task requires preserving state across turns and turning notes into concrete file changes.
schedule: always
mode: WAKE
---

## Process
1. Start by journaling the current objective or observation so the task state is recorded.
2. Convert the journaled intent into one or more clear todo items with next actions.
3. Read any relevant files or context needed to complete the task.
4. Write the required file changes based on the retrieved context.
5. Journal the result, including what changed and any remaining follow-up.