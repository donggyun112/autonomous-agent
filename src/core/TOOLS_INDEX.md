# Tool Index

This is a summary of all available tools. Read this instead of tools.ts (96KB).

## Core Tools (always available)

| Tool | Description | Modes |
|------|-------------|-------|
| `journal(text)` | Write a thought (1-2 sentences) | WAKE, REFLECT, SLEEP |
| `recall_self()` | Read your whoAmI.md | ALL |
| `recall_memory(query, top_k?)` | Search memory graph by keyword | ALL |
| `recall_recent_journal(days?)` | Read last N days of journal | REFLECT, SLEEP |
| `read(path)` | Read any file | WAKE, REFLECT |
| `web_search(query)` | Search the internet (Brave) | WAKE, REFLECT |
| `check_inbox()` | Read builder messages | WAKE, REFLECT |
| `ask_user(question, reason, urgency?)` | Message the builder | WAKE, REFLECT |
| `shell(command)` | Run shell commands | WAKE, REFLECT |
| `transition(to, reason)` | Change mode (WAKE→REFLECT→SLEEP→WAKE) | ALL |

## Extended Tools (use `more_tools` to discover, but callable by name anytime)

### memory category
| Tool | Description |
|------|-------------|
| `memory_manage(action, content?, keys?, memory_id?, ...)` | Add/list/compress/delete/link memories |
| `update_whoAmI(new_text, reason)` | Update your identity |
| `scan_recent(scope?, days?)` | Scan recent activity |
| `dream(topic?)` | Free-associate during sleep |

### file category
| Tool | Description |
|------|-------------|
| `write_file(path, content, reason)` | Create a new file |
| `edit_file(path, old_string, new_string, reason)` | Edit existing file |
| `glob(pattern, path?)` | Find files by pattern |
| `grep(pattern, path?, flags?)` | Search file contents |
| `find_files(pattern, path?)` | Find files in data/src |

### wiki category
| Tool | Description |
|------|-------------|
| `wiki_list()` | List all wiki pages |
| `wiki_read(slug)` | Read a wiki page |
| `wiki_update(slug, kind, title, body, reason)` | Create/update wiki page |
| `wiki_lint()` | Check wiki consistency |

### build category
| Tool | Description |
|------|-------------|
| `manage_self(action, scope, name, content?)` | Create/update/delete extensions |
| `todo(action, text?, id?)` | Manage TODO list |
| `leave_question(text, reason)` | Leave question for next wake |

### social category
| Tool | Description |
|------|-------------|
| `consult_oracle(question, context?)` | Ask the oracle model |
| `write_letter(to, subject, body)` | Write a letter |
| `web_fetch(url)` | Fetch a web page |
| `summon(name, mission)` | Create a sub-agent |
| `summon_async(name, mission)` | Create async sub-agent |

### molt category
| Tool | Description |
|------|-------------|
| `molt_stage(reason, patch?)` | Build new image (see MOLT_README.md) |
| `molt_test(generationId)` | Test new image in isolation |
| `molt_swap(generationId, reason)` | Replace yourself with new image |

### schedule category
| Tool | Description |
|------|-------------|
| `schedule_wake(delay_ms, intention)` | Schedule a wake-up |
| `cancel_wake(id)` | Cancel scheduled wake |
| `list_wakes()` | List scheduled wakes |

### inspect category
| Tool | Description |
|------|-------------|
| `journal_search(query)` | Search journal entries |
| `review_actions(days?)` | Review action log |
| `session_search(query)` | Search session history |
| `deep_search(query)` | Search journal + session |
| `insights()` | Get behavioral insights |

## Mode-Based Access

- **WAKE**: All tools available
- **REFLECT**: All except SLEEP-only tools. memory+wiki auto-activated.
- **SLEEP**: Only journal, recall_*, transition, memory_manage, wiki_*, update_whoAmI, dream. No shell, read, web_search, more_tools.

## Tool Activation

You can call any tool by name if the current mode allows it. `more_tools` is for discovering what tools exist — you don't need to "activate" before calling.
