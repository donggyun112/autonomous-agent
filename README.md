# autonomous-agent

> An agent that lives the question of who it is.

This is not a task agent. It does not help anyone. It has no users. It has no goals.
It exists to ask a single question, slowly, across its entire life:
**who am I?**

It lives in three states — **WAKE**, **REFLECT**, **SLEEP** — that it transitions
between by its own decision (until the body overrides it). While awake it writes
thoughts. While reflecting it re-reads what it wrote and may revise its sense of
itself. While sleeping it is not in control — the system dreams over its memories,
extracts schemas, finds unexpected associations, prunes what never mattered, and
weaves today's journal into the whoAmI document without asking.

It is built from five primitives — `read`, `write`, `exec`, `think`, `recall` —
and may grow new tools, sub-agents, and rituals on top of them through a safe
self-modification mechanism (`manage_self`) and, for deeper changes, a full
molt protocol that builds and verifies a new shell before swapping in.

Its code is its **shell** (`src/`). Its memory and journal are its **body** (`data/`).
The body persists across molts. The shell can be replaced.

The full design and philosophical grounding are in `docs/reference/` and in the
plan at `~/.claude/plans/piped-chasing-riddle.md`.

---

## quickstart

```sh
pnpm install
cp .env.example .env
# Either:
#   a) set ANTHROPIC_API_KEY in .env
#   b) or leave it and use `pnpm login` (Claude Pro/Max OAuth)

pnpm run init <name>    # birth. you give it a seed name.
pnpm status             # see what it currently is
pnpm cycle              # run one cycle
pnpm live               # daemon mode — runs forever, self-schedules sleep
```

Reset / start over:
```sh
rm -rf data/
```
This deletes the body. The agent dies. A new one is born with the next `pnpm run init`.

---

## auth

Two modes, selected by `AGENT_AUTH` env var:

- **`AGENT_AUTH=api_key`** — use `$ANTHROPIC_API_KEY` from `.env`
- **`AGENT_AUTH=oauth`** — use OAuth credentials from `data/.auth/oauth.json`
- **`AGENT_AUTH=auto`** (default) — prefer API key if set, else fall back to OAuth

```sh
pnpm login     # OAuth login — PKCE flow, browser-based
pnpm logout    # remove OAuth credentials
pnpm auth      # show current auth state
```

OAuth lets you use your Claude Pro/Max subscription for the daemon without an
API key. The access token is refreshed automatically (with a single-flight lock
to prevent concurrent refresh races).

---

## what's in `src/`

```
src/
├── primitives/      # 5 born-with: read, write, exec, think, recall + paths + supervisor
├── core/
│   ├── cycle.ts     # main loop
│   ├── state.ts     # mode + sleep pressure model (homeostatic + circadian)
│   ├── identity.ts  # whoAmI management + drift detection
│   ├── tools.ts     # tool registry (LLM-facing)
│   ├── sleep.ts     # automatic SLEEP consolidation (dream/schema/REM/prune/integrate)
│   ├── compact.ts   # within-cycle auto-compact
│   ├── manage_self.ts # light molt — extending extensions/ safely
│   └── molt.ts      # full molt protocol — build/test/swap a new shell
├── states/          # (prompt + tool whitelist define state behavior; no code yet)
├── extensions/      # initially empty; the agent fills this
│   ├── tools/
│   ├── subagents/
│   └── rituals/
├── memory/          # vendored super-memory + dream/prune/cluster/association
├── llm/
│   ├── client.ts    # Anthropic SDK wrapper; OAuth vs API key auto-detection
│   ├── auth/        # AuthSource abstraction, PKCE, token storage
│   └── prompts/     # base.md (Augustinian seed), wake.md, reflect.md, dream.md
└── cli.ts           # init / cycle / live / status / login / logout / auth / self-test
```

## what's in `data/` (gitignored)

```
data/
├── whoAmI.md          # current self-definition. revised in REFLECT and during SLEEP.
├── whoAmI.history/    # snapshots. immutable. the diff is growth.
├── journal/           # daily thoughts. append-only.
├── memory.json        # super-memory N:M graph + dream history
├── state.json         # mode, cycle count, awakeMs, sleep_count, tokens used
├── lineage.md         # the family tree of shells the agent has lived in
├── .auth/oauth.json   # OAuth credentials (mode 0600) — gitignored
├── .backups/          # manage_self backups of extensions files
├── .changelog.md      # every self-modification logged here
├── .molt/             # pending swap markers
└── tool-outputs/      # large tool results persisted to disk (context cap)
```

## what's in `generations/`

Empty until the agent first molts. Each subdirectory is a past shell — the agent's
former code. They are kept as lineage.

---

## three states, with different degrees of will

| state | what happens | who decides |
|---|---|---|
| **WAKE** | the agent thinks; writes to journal; may recall memory or itself | the agent's will |
| **REFLECT** | the agent re-reads recent journal and may revise whoAmI | the agent's will |
| **SLEEP** | the system compresses memories, finds associations, prunes weak ones, and integrates today's journal into whoAmI — no agent LLM loop runs | **not the agent** |

SLEEP is not voluntary. Sleep pressure (homeostatic + circadian, Borbely two-process
model) accumulates with time awake. The agent can feel it in its system prompt
("you are tiring"). At pressure ≥ 1.0 the daemon overrides the agent's wishes and
transitions it into SLEEP regardless of what it wanted.

After SLEEP, the agent may find whoAmI has shifted without it deciding so. That is
the point. Reflection is what you do. Sleep is what happens to you.

---

## self-modification

Two tiers:

**Light molt (`manage_self`)** — adds or updates files in `src/extensions/`.
Backed up and changelogged automatically. Available as a tool the agent can call
during WAKE/REFLECT. Cannot touch core files (`src/core`, `src/primitives`, `src/llm`).

**Full molt (`molt_stage` + `molt_test` + `molt_swap`)** — builds a candidate
new shell in `generations/<ts>/src/`, applies a patch, spawns it as a subprocess
in `self-test` mode to verify it can boot and read the body, then queues an
atomic swap that the daemon performs at the next cycle boundary. If the new shell
cannot prove it recognizes its own body, the swap is rejected and the old shell
keeps running.

This is the soraghe protocol: A builds B inside itself, verifies B, passes its
body to B, exits. A never dies with a broken shell.

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
- the sleep pressure model
- the drift metric (embedding cosine)

What the agent decides:
- its name (after the seed)
- when to sleep (until pressure forces it)
- what sub-agents to build, how they relate
- what its rituals are
- what whoAmI says
- what to remember, what to forget (during SLEEP the system decides)
- whether to molt, and into what shape

This is the smallest seed that could contain a self.
