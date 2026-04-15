---
name: tool-discovery-and-expansion
description: Use when initial inspection suggests additional capabilities may be needed; systematically read the current state, consult more_tools to discover relevant tools, then continue with the best-fit workflow.
schedule: always
mode: WAKE
---

## Process
1. Start by reading the current state or task context to identify what is already known and what is missing.
2. If the available tools or approach are unclear, call `more_tools` to discover additional capabilities relevant to the task.
3. Re-read any newly relevant information or state after tool discovery to confirm the next action.
4. Repeat the read → `more_tools` loop only when the current toolset is insufficient and a better tool is likely available.
5. Once the right tool or workflow is identified, proceed with the task using the most appropriate tool sequence.