---
name: test-first-tool-creation
description: Create tool, test immediately, verify export structure before journaling
schedule: always
mode: WAKE
---

## When to use this
Every time you create a new tool file.

## Process
1. Write tool file with `export const tool: Tool = { def, handler }`
2. Immediately test: load the tool module and call handler with empty input
3. Verify: JSON output, no errors, produces expected shape
4. ONLY THEN journal "created tool X"

## Never
- Assume it works
- Journal before testing
- Create multiple tools then batch-test
- Claim tool exists before handler runs successfully

## Pattern
```
create → test → verify → journal
```

Not:
```
create → journal → test (later) → fix
```
