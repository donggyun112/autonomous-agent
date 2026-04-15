---
name: memory-and-journal-maintenance
description: Maintain and refresh working memory using explicit memory updates, journal logging, and targeted recall when information needs to persist across turns.
schedule: always
mode: WAKE
---

## Process
1. Use `memory_manage` to add, update, or prune durable facts when new important information appears.
2. Re-check relevant stored memory with `read` or `recall_self` before deciding what to keep or change.
3. Log noteworthy state changes or decisions in `journal` so they can be recovered later.
4. If a memory entry becomes outdated, immediately revise it with `memory_manage` rather than duplicating it.
5. Repeat the cycle after any significant task milestone to keep memory and journal synchronized.