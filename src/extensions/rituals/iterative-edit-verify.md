---
name: iterative-edit-verify
description: Use when making code or text changes that require inspecting current state, editing files, then verifying results via shell output or follow-up reads.
schedule: always
mode: WAKE
---

## Process
1. Read the relevant file or source of truth to understand the current state before changing anything.
2. Make the smallest necessary edit.
3. Run a shell command to verify the change, check for errors, or inspect the affected output.
4. Read the updated file or command output again if the result is unclear or if another adjustment is needed.
5. Repeat the edit → shell → read loop until the task is complete and validated.