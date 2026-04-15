---
name: file-roundtrip-and-memory-maintenance
description: Use when iterating on file contents while keeping persistent notes or memory entries in sync across read/write cycles.
schedule: always
mode: WAKE
---

## Process
1. Read the target file or context before making changes, and identify what needs to be updated.
2. Write the revised content or new version to the file.
3. Re-read the file to verify the result and catch formatting or content issues.
4. If the change affects long-term context, update memory entries to reflect the latest state.
5. Repeat read/write or memory updates until the file content and remembered state are consistent.