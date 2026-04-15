---
name: focused-retrieval-and-inbox-triage
description: Efficiently gather context by chaining wiki reads or document reads, then check inbox items and follow up on related messages when investigating a task or request.
schedule: always
mode: WAKE
---

## Process
1. Start with the most relevant source of context, using `wiki_read` for internal reference material or `read` for document/content inspection.
2. If the first read reveals follow-up links, related sections, or missing context, immediately perform a second `wiki_read` or `read` to deepen the same line of inquiry.
3. When inbox attention is required, run `check_inbox` to identify new or actionable messages.
4. For any relevant message, use `read` to inspect the full content and extract required details.
5. Keep the sequence tight: alternate between retrieval and validation rather than scattering unrelated tool calls.