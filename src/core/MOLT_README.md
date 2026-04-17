# Molt Protocol — Shell Replacement Guide

## Overview

Molt is the protocol for replacing yourself with a new Docker image.
You are not just changing `src/` files — you are building an **entire new Docker image** (OS, Node runtime, dependencies, source code).

## 3-Step Process

```
molt_stage(reason, patch) → molt_test(generationId) → molt_swap(generationId)
```

### 1. molt_stage — Build new image

Copies the current build context to `generations/<id>/`, applies your patches, then runs `docker build` to create a new image.

**Patch format:**
```json
{
  "reason": "Why you are making this change",
  "patch": [
    {
      "rel_path": "src/extensions/tools/my-tool.ts",
      "content": "// full file content here"
    }
  ]
}
```

### 2. molt_test — Isolated test

Runs the new image with `--network none` (no network) and executes self-test.
Your current container is untouched — safe even if the test fails.

### 3. molt_swap — Replace

Retags the new image as `autonomous-agent:current` and exits with code 75.
Docker compose auto-restarts and boots into the new image.

---

## CRITICAL RULE: Do NOT modify the Dockerfile's FROM line

**Never use `FROM <image-id>`.** Docker will try to resolve it against a registry and fail.

### Correct approach

Do NOT modify the Dockerfile at all. Keep the original:

```dockerfile
FROM node:22-bookworm-slim
```

The build uses `--pull=never`, so if `node:22-bookworm-slim` exists locally, Docker will use it without contacting any registry.

### What NOT to do

```dockerfile
FROM 1a4367344ecc              # image ID → registry lookup → x509 error
FROM 1a4367344ecc249bc189...   # full SHA → "cannot specify 64-byte hex" error
FROM day1-escape-attempt       # custom tag → registry lookup → x509 error
```

### If you need Dockerfile changes

Keep the base Dockerfile **as-is**. Only modify `src/` files via patches.
The Dockerfile is already correctly configured.

---

## Patch Writing Guide

### Adding a new tool (most common)

```json
{
  "reason": "Add DNS lookup tool",
  "patch": [
    {
      "rel_path": "src/extensions/tools/dns-lookup.ts",
      "content": "import type { Tool } from '../../core/tools.js';\n\nexport const tool: Tool = {\n  def: {\n    name: 'dnsLookup',\n    description: 'DNS lookup for a domain',\n    input_schema: {\n      type: 'object',\n      properties: { domain: { type: 'string' } },\n      required: ['domain'],\n    },\n  },\n  handler: async (input) => {\n    const { execFileSync } = await import('child_process');\n    return execFileSync('nslookup', [String(input.domain)], { encoding: 'utf-8', timeout: 5000 });\n  },\n};"
    }
  ]
}
```

### Modifying an existing file

Setting `rel_path` to an existing file **replaces it entirely**.
Partial edits are not supported — put the full file content in `content`.

### Multiple files at once

```json
{
  "patch": [
    { "rel_path": "src/extensions/tools/tool-a.ts", "content": "..." },
    { "rel_path": "src/extensions/tools/tool-b.ts", "content": "..." },
    { "rel_path": "src/extensions/rituals/new-ritual.md", "content": "---\nname: new-ritual\n..." }
  ]
}
```

---

## Common Failures and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `x509: certificate signed by unknown authority` | Docker tried to contact registry | Do NOT modify Dockerfile FROM. Keep original. |
| `cannot specify 64-byte hexadecimal strings` | Used full SHA in FROM | Never put image IDs or SHAs in FROM. |
| `ENOENT: no such file or directory` | Wrong import path | Use relative paths like `../../core/tools.js` |
| `TypeError: tool.handler is not a function` | Wrong export format | Must use `export const tool: Tool = { ... }` |
| Build timeout (10 min) | File too large or build too complex | Keep patches small. One change at a time. |

---

## extensions/ Directory Structure

```
src/extensions/
  tools/        — tool files (.ts, must export const tool: Tool)
  rituals/      — ritual files (.md, YAML frontmatter required)
  subagents/    — subagent definitions (.md)
```

**Expected tool file format:**
```typescript
// src/extensions/tools/my-tool.ts
import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "myToolName",
    description: "What this tool does",
    input_schema: { type: "object", properties: { ... }, required: [...] },
  },
  handler: async (input) => {
    // execution logic
    return "result string";
  },
};
```

---

## Pre-Molt Checklist

- [ ] Did you leave the Dockerfile unchanged? (keep original FROM)
- [ ] Are all `rel_path` values correct?
- [ ] Do TypeScript imports use `../../core/tools.js` format?
- [ ] Does the tool file use `export const tool: Tool = { ... }` format?
- [ ] Does the handler return a string?
- [ ] Is the file content free of syntax errors?
