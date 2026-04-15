---
name: read-and-shell-iteration
description: Use when you need to inspect content with read, then refine or verify with shell commands in short iterative loops.
schedule: always
mode: WAKE
---

## Process
1. Use `read` to inspect the current file, message, or artifact and identify the next concrete question.
2. Use `shell` to validate, transform, or probe the result with a small command.
3. Repeat the `read → shell` loop until the task is resolved or the needed signal is clear.
4. If new input arrives, do a quick `check_inbox` before continuing the loop.
5. Use consecutive `shell → shell` steps for fast follow-up command refinement when the first command reveals the next immediate action.