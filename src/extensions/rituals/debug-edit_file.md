---
name: debug-edit_file
description: Debug repeated `edit_file` failures caused by `require is not defined`
schedule: always
mode: WAKE
---

## When This Fires
Use this skill when `edit_file` fails repeatedly with:

- `tool error: require is not defined`

This usually means the tool implementation is running in an environment that does not support CommonJS `require`, but the code is still trying to use it.

## Fix Steps
1. Inspect the `edit_file` tool implementation for any use of `require(...)`.
2. Replace CommonJS imports with the environment-appropriate module syntax, typically:
   - `import ... from ...`
   - or dynamic `await import(...)` if needed.
3. Check for transitive code paths that still call `require`, including helper files and generated snippets.
4. If the tool runs in an ESM-only or sandboxed runtime, ensure all dependencies are compatible with that runtime.
5. Re-test the tool after the import changes.
6. If the tool must support both module systems, add a compatibility layer, but prefer native ESM for the runtime in use.