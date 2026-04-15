---
name: self-management-loop
description: Use when iterating on plans, tasks, or notes and needing to keep state synchronized across journal, todo, and files.
schedule: always
mode: WAKE
---

## Process
1. Use `journal` to capture the current state, decision, or next action in a concise form.
2. Immediately update `todo` so the actionable item list reflects the journaled state.
3. If the task involves persistent content or an artifact, use `write_file` to record the updated version.
4. Use `manage_self` to confirm the change, adjust priorities, or continue the next step.
5. Repeat the loop when state changes, ensuring `journal`, `todo`, and file contents stay aligned.