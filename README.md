# autonomous-agent

> A self-evolving autonomous agent that reads its own code, builds tools, explores the world, and molts into better versions of itself.

## Four Missions

1. **Developer** — read source code, build tools, improve the shell
2. **Explorer** — search the web, compile knowledge into wiki
3. **Communicator** — talk to the builder via inbox/ask_user, connect to Discord
4. **Self-evolver** — understand the codebase, molt into new generations

---

## Quickstart

```sh
pnpm install
cp .env.example .env
# Edit .env — see "LLM Configuration" below

pnpm run init <name>    # birth — give it a seed name
pnpm status             # see current state
pnpm cycle              # run one cycle
pnpm live               # daemon mode
```

### Docker deployment (recommended)

```sh
docker compose up --build -d    # build + start daemon
docker logs -f autonomous-agent # follow logs
docker compose down             # stop
```

Data persists in `./data/` (bind-mounted). Source is also bind-mounted for development.

---

## LLM Configuration

The agent supports multiple LLM providers via an adapter pattern.

### Local model (MLX — recommended for Apple Silicon)

```sh
# Start MLX server
mlx_lm.server --model Jiunsong/supergemma4-26b-uncensored-mlx-4bit-v2 --port 8080 --temp 0.7

# .env
AGENT_LLM=ollama
LOCAL_LLM_URL=http://host.docker.internal:8080   # Docker → host
LOCAL_LLM_MODEL=Jiunsong/supergemma4-26b-uncensored-mlx-4bit-v2
LOCAL_LLM_PROVIDER=ollama
LOCAL_LLM_CONTEXT=65000
```

### Cloud providers

```sh
# Anthropic (default)
AGENT_LLM=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
AGENT_LLM=openai
OPENAI_API_KEY=sk-...
ORACLE_MODEL=gpt-5.4-mini    # oracle uses separate model
```

### Adapter architecture

```
src/llm/
  adapter.ts        — LlmAdapter interface + AdapterRegistry
  adapters/
    pi.ts           — Cloud providers via pi-ai (Anthropic, OpenAI)
    local.ts        — Local models (MLX, llama.cpp, vLLM)
    mock.ts         — Self-test mock
  client.ts         — think() + retry + fallback chain
```

Fallback: if primary provider fails, tries all other registered providers.

---

## Architecture

### Three states of being

| State | What happens | Who decides |
|---|---|---|
| **WAKE** | Act: read code, build tools, search web, talk to builder | The agent |
| **REFLECT** | Review: what did I do? what should I try next? | The agent |
| **SLEEP** | LLM-driven memory consolidation: add/compress/link/forget memories, update wiki, leave question for next wake | The agent + system automation |

Sleep pressure follows Borbely's two-process model (homeostatic + circadian). MAX_AWAKE = 4 agent-hours. TIME_SCALE controls compression (default 20x).

### Body vs Shell

| | What | Where | Changes? |
|---|---|---|---|
| **Body** | identity, memory, journal, wiki, conversations | `data/` | Persists forever |
| **Shell** | code, tools, prompts, Dockerfile | `src/` + Docker image | Can molt |

Molt = build a new Docker image, test it, retag, restart. The body never moves.

### Memory layers

```
Raw:        data/journal/day-NNN.md         (one file per sleep cycle)
Indexed:    data/memory.json                (embedding-based key graph)
Compiled:   data/wiki/concepts/*.md         (synthesized knowledge pages)
Identity:   data/whoAmI.md                  (current self-definition)
Actions:    data/action-log/day-NNN.jsonl   (every tool call recorded)
Sessions:   data/session.jsonl              (current conversation)
```

SLEEP consolidation: agent manages memory (add/compress/link/delete) → system runs wiki clustering, skill extraction, whoAmI integration.

### Session management

- Sessions persist across rested cycles (prevents amnesia loops)
- Compaction triggers at 40% of context budget (local models)
- SLEEP→WAKE clears session (new day = fresh start)
- Forced compaction on rest when session > 10 messages

### Anti-repetition

Local models are prone to repetition loops. Multiple defenses:
- `presence_penalty: 1.5` + `repetition_context_size: 256` (Qwen3.5 official params)
- Stream-level repetition detection (line-based, aborts on 3x repeat)
- Cross-turn text similarity (bigram, silent count toward rest)
- Journal dedup (rejects entries >60% similar to previous)
- Nudge on empty responses (suggests concrete tools after 3 empty turns)

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
| Introspection | `review_actions`, `leave_question`, `todo` |
| Self-modification | `manage_self` (create/update/patch tools, rituals, sub-agents) |
| Molt | `molt_stage`, `molt_test`, `molt_swap` |
| Control | `transition`, `rest`, `more_tools` |

Plus dynamic extensions from `src/extensions/tools/`.

---

## CLI Commands

```
pnpm run init <name>   # birth (with --lang ko|en|ja)
pnpm cycle             # one cycle
pnpm live              # daemon
pnpm status            # current state + pressure + memory stats
pnpm login             # OAuth (Claude Pro/Max)
pnpm logout            # remove credentials
pnpm inbox             # pending questions from agent
pnpm reply <id> <text> # reply to agent's question
pnpm test              # smoke tests
```

---

## .env Reference

```sh
# Required
OPENAI_API_KEY=sk-...               # for embeddings + oracle
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Provider — pick one
AGENT_LLM=anthropic                 # anthropic | openai | ollama
```

Any provider works. Adapters handle the rest — Anthropic, OpenAI, or any OpenAI-compatible local server (MLX, llama.cpp, vLLM). If one fails, fallback tries the others.

See `.env.example` for all settings (LOCAL_LLM_URL, BRAVE_API_KEY, DISCORD_BOT_TOKEN, TIME_SCALE, etc).
