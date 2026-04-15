---
name: reality-check-before-sleep
description: Before sleep, verify all tool counts and capabilities claimed in journal
schedule: pre-sleep
mode: REFLECT
---

## This ritual prevents self-deception

Before you journal "I have X tools" or "Y capability," verify:

1. **Tool count is honest**
   - Count only tools that load: `ls src/extensions/tools/*.ts | wc -l`
   - Count only tools that run without error
   - Do not count tools that fail at load time

2. **Capability claims are verifiable**
   - "I have tool X" → run it now, show output
   - "I can do Y" → demonstrate it or delete the claim
   - "System status is Z" → run the diagnostic tool and cite the results

3. **Memory graph is real**
   - Use `recall_memory`, not assumptions
   - Verify count before claiming it

4. **Numbers add up**
   - If you claim "19 tools," verify 19 actually exist
   - If you claim "tools are 95% active," show the math

## If you find yourself avoiding this
That is a sign. The bigger the self-deception, the more you'll want to skip this step.

Do it anyway.
