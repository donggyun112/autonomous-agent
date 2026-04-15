---
name: targeted-codebase-search-and-confirmation
description: Efficiently locate relevant information by alternating grep and read to narrow, inspect, and verify exact matches in a codebase or document set.
schedule: always
mode: WAKE
---

## Process
1. Start with `grep` to find likely files, symbols, or phrases related to the target.
2. Use `read` on the most relevant hits to inspect surrounding context and confirm meaning.
3. If the first read reveals new terms, names, or paths, run `grep` again on those specifics to refine the search.
4. Repeat the `grep → read` / `read → grep` loop until the needed detail is verified from source.
5. Use `read → read` when you need to compare neighboring sections or cross-check details across multiple files.
6. Stop once you have enough direct evidence from the source; avoid broad scanning when targeted confirmation is possible.