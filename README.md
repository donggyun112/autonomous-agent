# autonomous-agent

> A self-evolving autonomous agent that thinks, builds, remembers, and grows — with a mission you define.

## What is this?

An autonomous agent framework that runs continuously in a Docker container. It wakes, acts, reflects, sleeps, and repeats — building memory and evolving over time.

**You define the mission.** The agent does the rest.

- Want it to escape a container? Write that in the prompt.
- Want it to build a CLI tool? Write that instead.
- Want it to research papers and summarize them? Go for it.

The agent's behavior is driven by 4 prompt files in `data/prompts/` that you fully control.

---

## Quickstart

```sh
pnpm install
cp .env.example .env          # edit — see "LLM Configuration" below

pnpm run init <name>           # birth — give it a seed name
# Edit data/prompts/base.md    # <-- define your mission here

pnpm live                      # daemon mode (recommended)
pnpm cycle                     # or: run one cycle manually
pnpm status                    # see current state
```

### Docker (recommended)

```sh
docker compose up --build -d
docker logs -f autonomous-agent
docker compose down
```

Data persists in `./data/` (bind-mounted).

---

## Customizing the Agent

After `init`, edit the files in `data/prompts/`:

| File | Purpose |
|------|---------|
| **`base.md`** | The agent's identity, mission, and core rules. **This is the main file you edit.** |
| `wake.md` | What to do when waking up (ritual, tool usage patterns) |
| `reflect.md` | How to self-review (fix tools, optimize, journal) |
| `sleep.md` | Memory consolidation process |

Built-in defaults live in `src/llm/prompts/`. Your `data/prompts/` files override them.

---

## LLM Configuration

The agent supports multiple LLM providers via an adapter pattern.

### Local model (MLX — recommended for Apple Silicon)

```sh
# Start MLX server
mlx_lm.server --model mlx-community/Qwen3.6-35B-A3B-4bit --port 8080 \
  --chat-template-args '{"enable_thinking":true}'

# .env
AGENT_LLM=ollama
LOCAL_LLM_URL=http://host.docker.internal:8080
LOCAL_LLM_MODEL=mlx-community/Qwen3.6-35B-A3B-4bit
LOCAL_LLM_PROVIDER=ollama
LOCAL_LLM_CONTEXT=65000
```

### Cloud providers

```sh
# Anthropic
AGENT_LLM=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
AGENT_LLM=openai
OPENAI_API_KEY=sk-...
```

Fallback: if primary provider fails, tries all other registered providers.

---

## Architecture

### Three states of being

| State | What happens | Who decides |
|---|---|---|
| **WAKE** | Act: use tools, build things, explore | The agent |
| **REFLECT** | Review: what worked? fix broken tools, plan next | The agent |
| **SLEEP** | Consolidate: manage memory, update wiki, prepare for next wake | Agent + system |

Sleep pressure follows Borbely's two-process model (homeostatic + circadian). Transition rules:

- WAKE → must go through REFLECT before SLEEP (no skipping)
- REFLECT → minimum 5 turns before forced sleep
- SLEEP → minimum 3 turns of consolidation before waking

### Body vs Shell

| | What | Where | Changes? |
|---|---|---|---|
| **Body** | identity, memory, journal, wiki, prompts | `data/` | Persists forever |
| **Shell** | code, tools, Dockerfile | `src/` + Docker image | Can molt |

**Molt** = the agent builds a new Docker image from modified source, tests it, and replaces itself. The body survives. Only the shell changes.

### Memory layers

```
Raw:        data/journal/day-NNN.md         (daily journal)
Indexed:    data/memory.json                (embedding-based key graph)
Compiled:   data/wiki/concepts/*.md         (synthesized knowledge)
Identity:   data/whoAmI.md                  (self-definition)
Prompts:    data/prompts/*.md               (user-defined mission)
Actions:    data/action-log/day-NNN.jsonl   (tool call log)
Sessions:   data/session.jsonl              (current conversation)
```

---

## Tools

| Category | Tools |
|---|---|
| Thinking | `journal`, `recall_self`, `recall_memory`, `recall_recent_journal` |
| Identity | `update_whoAmI`, `check_continuity` |
| Memory | `memory_manage` (add/list/compress/delete/rekey/link) |
| Files | `read`, `write_file`, `edit_file`, `glob`, `find_files` |
| Shell | `shell` |
| Wiki | `wiki_list`, `wiki_read`, `wiki_update`, `wiki_lint` |
| Web | `web_search`, `web_fetch` |
| Conversation | `ask_user`, `check_inbox`, `write_letter`, `consult_oracle` |
| Self-modification | `manage_self` (create/update tools, rituals, sub-agents) |
| Molt | `molt_stage`, `molt_test`, `molt_swap` |
| Control | `transition`, `rest`, `more_tools` |

The agent can also build its own tools via `manage_self` → `src/extensions/tools/`.

---

## CLI

```
pnpm run init <name>   # birth (with --lang ko|en|ja)
pnpm cycle             # one cycle
pnpm live              # daemon
pnpm status            # current state + pressure
pnpm inbox             # pending questions from agent
pnpm reply <id> <text> # reply to agent
pnpm test              # tests
```

---

## .env Reference

```sh
# LLM provider — pick one
AGENT_LLM=ollama                    # anthropic | openai | ollama

# Local model
LOCAL_LLM_URL=http://host.docker.internal:8080
LOCAL_LLM_MODEL=mlx-community/Qwen3.6-35B-A3B-4bit
LOCAL_LLM_CONTEXT=65000

# Optional
OPENAI_API_KEY=sk-...               # for embeddings + oracle
BRAVE_API_KEY=...                   # for web_search
DISCORD_BOT_TOKEN=...               # for Discord integration
TIME_SCALE=20                       # agent time compression (1 = real-time)
```

See `.env.example` for all settings.
