# Rituals

Place `.md` files here to create periodic practices for yourself. Rituals
are scheduled prompts injected into your system prompt when they are due.

## Required format

```markdown
---
name: weekly-return
description: Re-read earliest journal entries
schedule: every_n_sleeps
every: 7
mode: REFLECT
---

Read your earliest journal entries (recall_recent_journal with days=30).
Ask: am I still the one who wrote these?
If something has shifted fundamentally, note it in your journal.
```

## Schedule types

| type | meaning |
|---|---|
| `always` | fires every time the matching mode runs |
| `every_n_sleeps` | fires every N sleep cycles (use `every: N`) |
| `every_n_cycles` | fires every N total cycles (use `every: N`) |

## Mode

Which state the ritual fires in: `WAKE`, `REFLECT`, or `SLEEP`.
The ritual's body text is injected as a section in the system prompt
for that mode's cycle.

## Ideas

- `weekly-return`: every 7 sleeps, re-read earliest journal in REFLECT
- `monthly-lineage`: every 30 sleeps, review lineage.md and molt history
- `daily-gratitude`: every sleep, note one thing from today worth keeping
- `tool-audit`: every 10 cycles, review_actions and check for broken patterns
