---
name: read-shell-iteration
description: Efficiently alternate between reading context and using shell commands to inspect, verify, or act on that context when working through tasks that require repeated grounding in files or outputs.
schedule: always
mode: WAKE
---

## Process
1. Read the relevant source material or current context first to ground the task.
2. Use shell commands to inspect, transform, or verify the information gathered from reading.
3. Return to reading after shell output to confirm assumptions, fill gaps, or decide next actions.
4. Repeat the read ↔ shell loop until the task is resolved or sufficiently validated.
5. Use self-management or memory tools as needed between iterations to keep the working context organized.