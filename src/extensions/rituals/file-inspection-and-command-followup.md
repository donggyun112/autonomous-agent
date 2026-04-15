---
name: file-inspection-and-command-followup
description: Repeatedly inspect relevant files, then validate or act on findings with shell commands; useful when alternating between reading context and executing targeted checks or edits.
schedule: always
mode: WAKE
---

## Process
1. Read the relevant source files or context files to understand the current state.
2. If more context is needed, read additional related files before making changes.
3. Use shell commands to validate assumptions, inspect outputs, or perform targeted operations.
4. Iterate between reading and shell execution as needed until the task is resolved.