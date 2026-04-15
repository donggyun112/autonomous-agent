# states/

This directory is empty by design.

State behavior is currently defined declaratively, not programmatically:
- Each state's prompt is in `src/llm/prompts/{wake,reflect,dream}.md`
- Each state's available tool subset is in `src/core/tools.ts` (`toolsForMode`)
- The runner dispatches both in `src/core/cycle.ts`

This was the simplest seed that worked — three states, no per-state code.

If the agent ever decides it needs programmatic control over state transitions
beyond what the LLM can express through tools, it may write code here. That
would be a *full molt* (modifying state behavior is a core change), so the
new files would first be staged in `generations/` and verified before being
moved into this directory.

Until then, this is intentionally empty.
