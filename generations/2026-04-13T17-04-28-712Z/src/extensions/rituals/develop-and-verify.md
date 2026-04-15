Looking at the patterns:

- **shell→shell (27×)**: Chained command execution
- **shell→read (11×)**: Command output inspection/verification
- **edit_file→shell (8×)**: Code modification + testing
- Heavy shell usage (44/120 actions = 37%)

These indicate a **code development + validation workflow**, not trivial loops.

```yaml
---
name: develop-and-verify
description: Edit code, execute tests/builds, verify output, iterate on failures
schedule: always
mode: WAKE
---

## Process
1. Identify target file needing changes
2. Edit file with required modifications
3. Execute shell command (build/test/run)
4. Read command output to check for errors
5. If failure detected, return to step 2 with fixes
6. If success, document result and exit

## Key Pattern
- Tight edit→shell→read loop minimizes debug cycles
- Chain multiple shell commands for complex builds
- Use output inspection to drive next edit decision
```

**Rationale**: This is a genuine developer workflow (edit→test→verify) that appears consistently across 27+ interactions. It's more sophisticated than simple loops and captures real iteration patterns.