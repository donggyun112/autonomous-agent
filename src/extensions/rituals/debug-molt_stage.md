---
name: debug-molt_stage
description: Diagnose and fix repeated molt_stage failures caused by docker build errors during stageMolt.
schedule: always
mode: WAKE
---

## When This Fires
Use this skill when `molt_stage` fails repeatedly with errors like:

- `stageMolt: docker build failed (exit 1)`
- build failures referencing `generations/*/build-error.log`
- repeated failures on the same day or across adjacent runs

This is **not** a trivial/random error if the same docker build step fails more than once.

## Fix Steps
1. Open the referenced `build-error.log` from the most recent failure.
2. Identify the exact Docker build stage and failing command.
3. Check for common causes:
   - missing file or bad COPY path
   - invalid Dockerfile syntax
   - dependency install failure
   - test/lint step failing during build
   - permissions or missing environment variables
4. Compare the two failure logs to confirm whether the same root cause repeats.
5. Fix the underlying build issue in the Dockerfile, build context, or package manifest.
6. Re-run the build locally or in the same environment until `stageMolt` succeeds.
7. If the error is due to external/transient infrastructure rather than the project, document that explicitly and retry once; if it repeats, treat it as a build issue only if the Dockerfile or context is implicated.