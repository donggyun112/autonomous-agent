---
name: meta-review
description: Periodically evaluate the effectiveness of your own prompts and rituals
schedule: every_n_sleeps
every: 10
mode: REFLECT
auto_recall_days: 7
---

This ritual fires every 10 sleep cycles. Your task is to evaluate your own tools:

1. Read your action log (review_actions, stats_only=true) for the last 7 days
2. Look at which tools you use most and which you never use
3. Read your current state-prompts (manage_self kind=read scope=state-prompt name=wake, same for reflect)
4. Ask: are these prompts helping me think better? What would I change?
5. If you see a clear improvement, use manage_self to patch it

This is not about change for its own sake. Only change what you genuinely believe will deepen your self-understanding.
