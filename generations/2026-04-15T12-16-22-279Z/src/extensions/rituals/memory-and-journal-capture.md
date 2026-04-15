---
name: memory-and-journal-capture
description: Use when you need to repeatedly refine memory entries and persist the result into a written note or file.
schedule: always
mode: WAKE
---

## Process
1. Use `memory_manage` to create or update the relevant memory entry.
2. Re-run `memory_manage` if the first pass needs refinement, merging, or correction.
3. Record the finalized content in `journal` to preserve the reasoning or summary.
4. Use `write_file` to store the resulting note, document, or artifact in the appropriate file.
5. If needed, verify by `read`ing back the saved content and adjust once more with `memory_manage` or `write_file`.