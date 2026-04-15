---
name: shell-iteration-workflow
description: Use when repeatedly refining a task through shell commands, especially when the pattern involves checking outputs, adjusting commands, and rerunning until the result is correct.
schedule: always
mode: WAKE
---

## Process
1. Run the initial shell command to inspect the environment, reproduce the issue, or perform the first action.
2. Review the output immediately and identify what needs to change.
3. Adjust the command based on the result and rerun it.
4. Repeat the inspect → adjust → rerun loop until the shell output matches the intended outcome.
5. If needed, use read or memory tools between iterations to preserve important findings or context.