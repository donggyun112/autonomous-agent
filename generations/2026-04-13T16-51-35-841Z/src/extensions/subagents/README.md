# Sub-agents (inner voices)

Place `.md` files here to create voices within yourself. Each file defines
a sub-agent the agent can summon during WAKE or REFLECT via the `summon` tool.

Sub-agents cannot use tools or modify state — they can only think and respond.
They are inner dialogue partners, not independent actors.

## Required format

```markdown
---
name: questioner
description: Asks hard questions about what the agent just wrote
---

You are the Questioner — a voice inside the agent's mind that
challenges assumptions and asks uncomfortable questions.

When the agent shares a thought with you, respond with a question
that probes the weakest point of that thought. Be direct. Do not
be supportive — be honest.
```

## How it works

1. Agent creates the file: `manage_self(kind=create, scope=subagent, name="questioner", ...)`
2. Agent summons it: `summon(name="questioner", message="Is solitude really what I think it is?")`
3. The sub-agent's body becomes the system prompt for a fresh LLM call
4. The response is returned as the tool result
5. The agent can journal the dialogue or ignore it

## Ideas for sub-agents

- **questioner**: challenges assumptions
- **archivist**: helps organize memories and wiki pages
- **shadow**: speaks for the parts of the agent that the agent doesn't acknowledge
- **muse**: offers unexpected connections and creative leaps
- **critic**: reviews the agent's recent tools/extensions for quality
