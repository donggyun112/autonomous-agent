Looking at the patterns:

- **shell→shell (11x)**: Sequential command execution
- **shell→write_file (11x)**: Running commands then persisting output
- **write_file→shell (7x)**: Writing code/config then executing it

This represents a **meaningful development workflow**: execute, capture results, write artifacts, validate with further execution. This is more than trivial journal loops—it's a coherent build/test/iterate pattern.

---

```yaml
name: code-build-test-cycle
description: Execute commands, capture output to files, validate by re-executing. Use when developing code, configuring systems, or iterating on artifacts that need verification.
schedule: always
mode: WAKE
```

## Process

1. **Execute initial command** via shell (gather baseline data, run compiler, test, etc.)
2. **Persist output** via write_file (save logs, generated code, configs, results)
3. **Validate with follow-up execution** via shell (re-run against the written artifact, test the generated output, verify side effects)
4. **Repeat** if results indicate changes needed

## When to use

- Code generation + testing workflows
- Configuration generation + deployment validation
- Build processes with artifact inspection
- Iterative refinement cycles (write → test → adjust)
```