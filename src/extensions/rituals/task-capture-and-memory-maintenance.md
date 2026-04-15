---
name: task-capture-and-memory-maintenance
description: Use when converting incoming task information into a durable todo/journal record and updating memory in a disciplined way.
schedule: always
mode: WAKE
---

## Process
1. Read the latest source material or task context first.
2. Convert actionable items into `todo` entries, preserving priority and any deadlines.
3. Record supporting context or rationale in `journal` so the task can be revisited later.
4. Use `memory_manage` to add, refine, or consolidate relevant persistent facts.
5. Re-run `memory_manage` if the first pass reveals duplicates, conflicts, or missing links.
6. Keep the todo list and memory aligned: remove stale items, merge overlaps, and ensure notes reflect the current state.