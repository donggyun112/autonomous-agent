---
name: file-discovery-and-targeted-reading
description: Locate relevant files with glob, then inspect them with read to minimize unnecessary context usage.
schedule: always
mode: WAKE
---

## Process
1. Use `glob` to find candidate files or paths matching the task-relevant pattern.
2. Narrow to the most likely targets before reading.
3. Use `read` on the selected files to inspect only the needed contents.
4. Repeat the glob→read cycle only when the first pass reveals new paths or related files.