---
name: file-backed-task-and-memory-iteration
description: Use when work requires repeatedly refining notes, tasks, or memory state by writing a file, reading it back, and updating memory/todo entries in a tight loop.
schedule: always
mode: WAKE
---

## Process
1. Start by creating or updating the working file with the current draft, plan, or state.
2. Read the file back immediately to verify what was written and catch mismatches.
3. Update memory entries with the confirmed state, then re-run memory management to consolidate or correct it.
4. Record actionable next steps in the todo tool, then write the updated todo state back to the file.
5. Repeat the cycle whenever new information changes the file contents or memory state.
6. Keep the file, memory, and todo list aligned so each reflects the latest validated state.