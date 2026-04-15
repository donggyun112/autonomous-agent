---
name: shell-read-investigation
description: Systematically inspect files or command output with shell, then read the relevant artifacts, and record findings in journal when the sequence repeats during debugging or analysis.
schedule: always
mode: WAKE
---

## Process
1. Use `shell` to generate or inspect the next concrete artifact (list files, run a command, reproduce the issue, print a snippet).
2. Use `read` to examine the specific file/output that the shell step identified.
3. Synthesize what was learned and write a concise note in `journal` if the observation changes the working understanding.
4. Repeat the shell→read loop as needed until the target is understood or the next action is clear.
5. If the journal changes the plan, use `shell` again to test the updated hypothesis or inspect the next artifact.