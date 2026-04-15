---
name: read-shell-investigation-loop
description: Use when iterating on source files or system state by alternating between reading content and running shell commands to confirm assumptions, inspect outputs, and refine the next read.
schedule: always
mode: WAKE
---

## Process
1. Read the relevant file, log, or artifact to establish the current state and identify what needs verification.
2. Run a shell command to test, inspect, or reproduce the hypothesis formed from the read step.
3. Read the resulting output, error, or changed file state to interpret the command results.
4. Repeat the read → shell → read cycle until the target issue, change, or investigation is resolved.
5. Keep each loop focused on one question at a time so the next shell action is informed by the latest read.