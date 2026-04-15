---
name: tool-discovery-and-inbox-triage
description: Systematically discover available tools, then check and process inbox items before proceeding with task work.
schedule: always
mode: WAKE
---

## Process
1. Use `more_tools` iteratively when the current toolset may be insufficient or when new capabilities are needed.
2. Check the inbox with `check_inbox` to surface any pending messages, assignments, or interruptions.
3. Use `read` to inspect each relevant inbox item or document thoroughly.
4. If a `read` result points to another linked item or requires follow-up, `read` again until the needed context is complete.
5. After tool discovery and inbox triage, proceed with the main task using the newly identified tools or clarified context.