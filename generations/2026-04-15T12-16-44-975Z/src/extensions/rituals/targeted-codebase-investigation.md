---
name: targeted-codebase-investigation
description: Systematic lookup-and-verify workflow for exploring code or text sources by alternating grep, read, and shell to find relevant locations, inspect context, and confirm assumptions.
schedule: always
mode: WAKE
---

## Process
1. Use `grep` to locate candidate files, symbols, or phrases relevant to the question.
2. Use `read` to inspect the most promising matches in context.
3. Use `shell` when you need broader confirmation, filtering, or to run a quick command that validates what `read` revealed.
4. Repeat the loop: `grep → read → shell` or `read → grep` to narrow the search space and converge on the exact evidence.
5. Prefer evidence-driven refinement: after each read, update the search terms based on names, paths, or details discovered.
6. Stop when you have enough direct support to answer or act confidently.