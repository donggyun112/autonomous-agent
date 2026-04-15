---
name: focused-retrieval-and-summarization
description: Efficiently locate relevant information by iterating between targeted searching and close reading, then synthesize findings into a concise working summary.
schedule: always
mode: WAKE
---

## Process
1. Start with a narrow search using `grep` to identify likely relevant files, terms, or sections.
2. Use `read` to inspect the matched content closely and confirm context.
3. Repeat `grep` → `read` when the initial result is incomplete or produces adjacent references that may be more relevant.
4. Use `shell` as needed for quick orchestration tasks, path discovery, or lightweight validation between search/read passes.
5. Record the distilled result in `journal` once the relevant information is confirmed.