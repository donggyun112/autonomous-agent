---
name: file-and-memory-workflow
description: Efficiently plan work with todo, persist notes to files, and maintain memory state while iterating on content.
schedule: always
mode: WAKE
---

## Process
1. Create or update a concise todo plan before making changes.
2. Write the working content or notes to a file.
3. Read the file back to verify the result and catch issues.
4. Update memory state when the task context, decisions, or persistent facts change.
5. Repeat the todo → write_file → read → memory_manage loop as needed until the output is stable.