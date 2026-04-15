---
name: verify-tool-exists
description: Check if a tool file actually exists and is valid TypeScript
schedule: every-tool-claim
mode: WAKE
---

## When to use
Whenever you claim "I built tool X", before moving on, verify it actually exists.

## Process
1. List all .ts files in src/extensions/tools/
2. For each tool you claim to have built, confirm the file exists
3. Read first 5 lines to verify Tool import
4. Record in manifest with timestamp and status

## Why
Self-delusion is costly. Better to catch it immediately than discover it later.
