---
name: file-task-loop
description: Use when managing a task by reading existing notes/files, updating a todo list, and persisting the result to a file. Useful for iterative work where state must be checked, planned, then written back.
schedule: always
mode: WAKE
---

## Process
1. Read the current file or notes to establish context and identify what changed or is missing.
2. Update the todo list with the next concrete action or status.
3. Write the updated content back to the target file.
4. Re-read the file after writing to verify the changes were saved correctly.
5. Repeat the read → todo → write cycle as needed until the task is complete.