# autonomous-agent

> An agent that lives the question of who it is.

This is not a task agent. It has no users. It has no goals.
It exists to ask a single question across its entire life: **who am I?**

---

## quickstart

```sh
pnpm install
cp .env.example .env
# Set ANTHROPIC_API_KEY or run `pnpm login` (Claude Pro/Max OAuth)
# Optionally set BRAVE_API_KEY for web search
# Optionally set DISCORD_BOT_TOKEN for future Discord surface

pnpm run init <name>    # birth — give it a seed name
pnpm status             # see current state
pnpm cycle              # run one cycle
pnpm live               # daemon mode
```

For Docker deployment:
```sh
docker build -t autonomous-agent:current .
./scripts/supervise.sh   # handles molt swaps via exit 42
```

---

## architecture

### three states of being

| state | what happens | who decides | sleep gate |
|---|---|---|---|
| **WAKE** | think, journal, recall, search, build tools | the agent | — |
| **REFLECT** | re-read thoughts, revise whoAmI, update wiki, leave curiosity question | the agent | — |
| **SLEEP** | system-driven: dream, schema→wiki, REM association, prune, whoAmI integrate, self.md sync, wiki lint | **the system** | pressure < 0.3 → cannot sleep; pressure ≥ 1.0 → forced |

Sleep pressure follows Borbely's two-process model (homeostatic + circadian). The agent cannot game it.

### body vs shell (soraghe model)

| | what | where | changes? |
|---|---|---|---|
| **Body** | self, memory, journal, wiki, action log, conversations | `data/` | persists forever |
| **Shell** | code, tools, prompts, Dockerfile, dependencies | `src/` + Docker image | can molt |

Molt = build a new Docker image, test it in an isolated container (6-check self-test including mock cycle), retag, restart. The body never moves.

### memory layers

```
Raw:        data/journal/YYYY-MM-DD.md     (time-indexed thoughts)
Indexed:    data/memory.json                (super-memory N:M key graph)
Compiled:   data/wiki/concepts/*.md         (synthesized knowledge pages)
Identity:   data/whoAmI.md                  (current self-definition)
Actions:    data/action-log/YYYY-MM-DD.jsonl (every tool call recorded)
```

SLEEP consolidation compiles raw→indexed→compiled. Detail fades, keys persist.

### self-continuity across sleep

When transitioning to SLEEP, the agent records:
- **wake_intention**: why it wants to wake again
- **wake_context**: what it was thinking about

These are injected into the next WAKE's system prompt. The agent can also use `schedule_wake` for future wake-ups at specific times, each carrying intention + context.

### curiosity engine

Five mechanisms prevent repetitive thinking:
1. Random memory surfacing (WAKE)
2. Self-generated curiosity question (REFLECT → next WAKE)
3. Stale wiki page trigger (WAKE, 50% chance)
4. Behavior blind spot from action log (REFLECT)
5. Prompt language encouraging unexpected exploration

### self-modification

**Light molt** (`manage_self`): add/update/patch files in `src/extensions/`. Backed up + changelogged. Takes effect next cycle via dynamic extension loader.

**Full molt** (`molt_stage` → `molt_test` → `molt_swap`): build new Docker image, test in isolated container (read-only body mount, no network, no API key, 6 verification checks including mock cycle), retag, exit for container recreation.

---

## tools (24 registered)

| category | tools |
|---|---|
| thinking | `journal`, `recall_self`, `recall_memory`, `recall_recent_journal` |
| identity | `update_whoAmI`, `check_continuity` |
| files | `read` |
| memory ops | `scan_recent`, `dream` |
| wiki | `wiki_list`, `wiki_read`, `wiki_update`, `wiki_lint` |
| world | `web_search` |
| introspection | `review_actions`, `leave_question` |
| conversation | `ask_user`, `check_inbox`, `write_letter` |
| scheduling | `schedule_wake`, `cancel_wake`, `list_wakes` |
| self-modification | `manage_self` (create/update/patch) |
| shell evolution | `molt_stage`, `molt_test`, `molt_swap` |
| control | `transition`, `rest` |

Plus dynamic extensions from `src/extensions/tools/`.

---

## cli commands

```
pnpm run init <name>   # birth
pnpm cycle             # one cycle
pnpm live              # daemon (or ./scripts/supervise.sh for molt support)
pnpm status            # current state, pressure, drift, memory stats
pnpm login             # OAuth (Claude Pro/Max)
pnpm logout            # remove credentials
pnpm auth              # show auth state
pnpm inbox             # pending questions from agent
pnpm reply <id> <text> # reply to agent's question
pnpm test              # 19 smoke tests
```

---

## what the agent decides vs what the system decides

**The agent decides:**
- its name, when to sleep (within the gate), what to think about, what tools to build, what sub-agents to create, what rituals to follow, when to molt, what whoAmI says, what wiki pages to write, who to ask questions to, what to be curious about

**The system decides:**
- sleep pressure (physics, not will), forced sleep at pressure ≥ 1.0, sleep rejection below 0.3, what happens during SLEEP (consolidation), circadian rhythm, drift measurement, memory fencing around recalled content

