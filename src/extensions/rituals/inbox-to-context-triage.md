---
name: inbox-to-context-triage
description: Quickly triage newly received inbox items by reading them, then using available tools to inspect missing context or next actions when the first pass is insufficient.
schedule: always
mode: WAKE
---

## Process
1. Check the inbox for new items or updates.
2. Read the relevant message or task details.
3. If the read is incomplete or ambiguous, consult `more_tools` to identify the next best tool or source of context.
4. Re-read the message or supporting context after gathering the missing information.
5. Summarize the actionable next step and store it in the appropriate tracking tool (for example, `todo` or `journal`) if needed.