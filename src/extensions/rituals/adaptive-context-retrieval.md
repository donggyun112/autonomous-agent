---
name: adaptive-context-retrieval
description: Use when deciding whether current information is sufficient or when a task may require additional context, tools, or stored memory. It helps iteratively inspect notes, memory, and available tools before acting.
schedule: always
mode: WAKE
---

## Process
1. Start with the most relevant current context using `read`.
2. If the current context is insufficient, inspect available capabilities with `more_tools`.
3. Record any useful findings or decisions in `journal` before switching context.
4. Update long-term or working memory with `memory_manage` when the task changes state or important information needs persistence.
5. If needed, repeat the read → assess → document → memory update cycle until enough context is available to proceed safely.