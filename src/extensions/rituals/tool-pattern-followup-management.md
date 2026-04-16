---
name: tool-pattern-followup-management
description: Use when repeated tool use suggests the need to continue searching, refining, or managing state across multiple tool calls.
schedule: always
mode: WAKE
---

## Process
1. After an initial tool result, decide whether the next action should deepen the same line of investigation or adjust the search strategy.
2. If the current evidence is incomplete, use a follow-up tool call to either expand scope, narrow scope, or re-query state rather than stopping early.
3. When managing memory or similar stateful resources, inspect current contents before overwriting, merging, or deleting entries.
4. When a broad tool returns partial answers, chain another tool with a more specific target instead of repeating the same query unchanged.
5. Stop once the repeated calls are no longer improving coverage, precision, or state consistency.