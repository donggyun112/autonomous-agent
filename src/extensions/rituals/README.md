# Skills (Rituals)

Skills are reusable procedures created from patterns the agent discovers.
Markdown files with YAML frontmatter. ritual-loader injects them into the
system prompt at the right time.

## Format

```markdown
---
name: skill-name
description: "What this skill does. When to use it."
schedule: always
mode: WAKE
---

## When to Use
- [trigger condition]

## Process
1. [step]
2. [step]

## Verification
- [ ] [check]
```

## Schedule Types

| type | meaning |
|---|---|
| `always` | fires every time the matching mode runs |
| `every_n_sleeps` | fires every N sleep cycles (use `every: N`) |
| `every_n_cycles` | fires every N total cycles (use `every: N`) |

## When to Create a Skill (REFLECT phase)

If you notice during REFLECT:
- A pattern you repeated 2+ times → make it a procedure
- An error you fixed → make a debug skill
- A multi-step workflow → make it a checklist
- A tool combination that works → make it a recipe

Create with: `manage_self(kind="create", path="src/extensions/rituals/skill-name.md", content="...")`

## Skill Lifecycle

1. **Discover** — notice a pattern in review_actions or journal
2. **Extract** — write the pattern as a skill file
3. **Use** — skill loads into next WAKE prompt automatically
4. **Improve** — edit the skill when you find a better way
5. **Prune** — delete skills that don't help anymore
