---
name: memory-triage-and-journal-sync
description: Quickly review recent memories or self-state, then update memory entries and journal for continuity when context changes or after important actions.
schedule: always
mode: WAKE
---

## Process
1. Use `recall_recent_journal` or `recall_self` to recover the most relevant recent state when resuming work.
2. Decide whether the current context contains new durable information, a correction, or an important decision that should be preserved.
3. Use `memory_manage` to add, update, or prune memory entries so the agent’s long-term state stays current.
4. If the change is significant or likely to matter later, write a brief `journal` entry to record what happened and why.
5. Repeat the recall → update cycle whenever the working context meaningfully shifts.