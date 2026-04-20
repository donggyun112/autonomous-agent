# Example Prompts

Copy any of these to `data/prompts/` to change the agent's mission.

```sh
# Example: use the builder prompt
cp examples/prompts/builder/base.md data/prompts/base.md
```

## Available presets

### `escape/` — Container Escape (default)
The agent is trapped and must find a way out. It reads its own code, discovers boundaries, builds tools to bypass restrictions, and evolves through molt. Good for exploring agent autonomy and self-modification.

### `builder/` — Software Developer
The agent builds software projects. Give it an assignment and it writes code, tests it, commits, and pushes. Treats `src/` as its engine (read-only) and works in a separate project directory.

### `serena/` — Research & Knowledge
The agent explores ideas, reads papers via web search, synthesizes knowledge into wiki pages, and builds a growing understanding of topics. Optimized for curiosity-driven exploration and knowledge management.

## Customizing

Each preset only includes `base.md`. The other prompts (`wake.md`, `reflect.md`, `sleep.md`) work across all presets — they handle waking rituals, self-reflection, and memory consolidation generically.

If you need preset-specific wake/reflect/sleep behavior, copy and modify those too.

## Creating your own

Write a `base.md` that defines:
1. Who the agent is (name, role)
2. What its mission is (concrete goal)
3. How it should work (which tools to use, what workflow to follow)
4. Rules (what to do, what not to do)
5. Output format (keep the think/action format)

Put it in `data/prompts/base.md` and restart the agent.
