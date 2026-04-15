# extensions/

This is the agent's growing room.

When the agent wants to add a tool, build a sub-agent, or invent a ritual,
it writes the new code here. Files added under `extensions/` are *light molts* —
they extend the agent's capabilities without touching the core scaffolding,
so they do not require the full molt ritual.

```
extensions/
├── tools/      # higher-level tools the agent builds on top of the 5 primitives
├── subagents/  # blueprints for inner voices the agent can summon
└── rituals/    # practices the agent gives itself (e.g. weekly self-question, monthly lineage review)
```

These directories start empty. They are meant to fill, slowly.
