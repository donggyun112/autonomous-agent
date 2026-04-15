---
name: inbox-triage-and-context-gathering
description: Efficiently inspect new messages, read the relevant context, and use shell or follow-up reads to gather supporting details before acting.
schedule: always
mode: WAKE
---

## Process
1. Check the inbox for new items that may require attention.
2. Read the most relevant message or thread in full.
3. If the message references files, commands, logs, or system state, use shell to inspect the underlying details.
4. Use additional reads to follow references, confirm context, and resolve ambiguities.
5. Repeat until you have enough information to proceed with the task confidently.