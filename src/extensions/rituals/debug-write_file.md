---
name: debug-write_file
description: Diagnose and fix write_file failures caused by unsupported CommonJS usage like `require is not defined`.
schedule: always
mode: WAKE
---

## When This Fires
Use this skill when `write_file` fails repeatedly with:
- `require is not defined`
- similar runtime errors indicating CommonJS modules are not available
- code in the write payload assumes Node-style `require(...)`

## Fix Steps
1. Remove any `require(...)` usage from the file content being written.
2. Rewrite the snippet to use the environment’s supported module style:
   - `import ... from ...` if ES modules are supported
   - or avoid imports entirely if the file is meant to be plain text/config
3. Check for indirect CommonJS assumptions, such as:
   - `module.exports`
   - `exports.foo = ...`
   - `__dirname`, `__filename`
4. If the file is generated code, ensure the generator is not injecting Node-specific wrappers.
5. Retry the write after converting the content to a compatible format.

## Notes
This is a real recurring environment mismatch, not a random transient error.