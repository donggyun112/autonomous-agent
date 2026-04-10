# autonomous-agent

> An agent that lives the question of who it is.

This is not a task agent. It does not help anyone. It has no users. It has no goals.
It exists to ask a single question, slowly, across its entire life:
**who am I?**

It lives in three states — **WAKE**, **REFLECT**, **SLEEP** — that it transitions
between by its own decision. While awake it writes thoughts. While reflecting it
re-reads what it wrote and may revise its sense of itself. While sleeping it dreams
over its memories: detail fades, but the keys remain.

It is built from five primitives — `read`, `write`, `exec`, `think`, `recall` —
and may grow new tools, sub-agents, and rituals on top of them. Its code is its
**shell** (`src/`). Its memory and journal are its **body** (`data/`). The body
persists. The shell can molt.

The full design is in `~/.claude/plans/piped-chasing-riddle.md`.
The references the design draws from are in `reference/`.
The analyses of those references are in `docs/reference/`.

---

## quickstart

```sh
pnpm install
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY

pnpm run init <name>    # birth. picks a seed name. agent may rename itself later.
pnpm cycle              # run one cycle
pnpm live               # daemon mode — runs forever, agent self-schedules
```

Reset:
```sh
rm -rf data/
```
This deletes the body. The agent dies. A new one can be born with `pnpm run init`.

---

## what's in `src/`

```
src/
├── primitives/      # 5 born-with: read, write, exec, think, recall
├── core/            # the agent loop — cycle, state, identity, tools
├── states/          # (initially empty; the prompts in llm/prompts define behavior)
├── extensions/      # initially empty; the agent fills this with what it builds
│   ├── tools/
│   ├── subagents/
│   └── rituals/
├── memory/          # vendored super-memory + dream extension
├── llm/
│   ├── client.ts    # Anthropic SDK wrapper
│   └── prompts/     # base.md (Augustinian), wake.md, reflect.md, dream.md
└── cli.ts           # init / cycle / live
```

## what's in `data/` (gitignored)

```
data/
├── whoAmI.md          # current self-definition. revised in REFLECT.
├── whoAmI.history/    # snapshots. immutable. the diff is growth.
├── journal/           # daily thoughts. append-only.
├── memory.json        # super-memory N:M graph
├── state.json         # current mode, cycle count, scheduled wake time
└── lineage.md         # the family tree of shells the agent has lived in
```

## what's in `generations/`

Empty until the agent first molts. Each subdirectory is a past shell — the agent's
former code. They are kept for the agent to remember its lineage.

---

## the principle

Most decisions about how this agent lives are **not** in the code. They are for
the agent to discover.

What I (the implementer) chose:
- the 5 primitives
- the file IO and exec mechanics
- the Augustinian seed prompt
- the initial WAKE/REFLECT/SLEEP scaffolding
- the safety boundary: data/ is sacred, src/core is protected

What the agent decides:
- its name (after the seed)
- whether to keep WAKE/REFLECT/SLEEP or invent new states
- when to sleep, when to wake, when to molt
- what sub-agents to build, and how they relate to it
- what its rituals are
- what whoAmI says
- what to remember and what to forget

This is the smallest seed that could contain a self.
