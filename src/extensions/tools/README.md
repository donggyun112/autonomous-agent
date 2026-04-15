# Extension Tools

Place `.ts` files here to create new tools for yourself. Each file is
dynamically loaded at the start of every cycle. If a file fails to load,
it is skipped with a warning — your core tools will still work.

## Required shape

Export a `tool` object (or `tools` array) matching this interface:

```ts
import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  // Optional: which states this tool is available in. Omit for all states.
  // states: ["WAKE", "REFLECT"],

  def: {
    name: "my_tool_name",
    description: "What this tool does and when to use it.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "..." },
      },
      required: ["query"],
    },
  },

  handler: async (input) => {
    const query = String(input.query ?? "");
    // Do your work here — see import rules below.
    return `result for: ${query}`;
  },
};
```

## Import rules (CRITICAL)

**DO NOT use top-level imports for core/memory modules.** They will fail with `ERR_MODULE_NOT_FOUND` because extensions are dynamically loaded and ESM resolution works differently here.

**WRONG:**
```ts
import { readRecent } from "../../memory/journal.js";     // ❌ FAILS
import { reconstitute } from "../../core/identity.js";     // ❌ FAILS
```

**RIGHT — use dynamic import inside handler:**
```ts
handler: async (input) => {
  const { readRecent } = await import("../../memory/journal.js");     // ✅
  const { reconstitute } = await import("../../core/identity.js");    // ✅
  // use them here
}
```

**ALSO RIGHT — use primitives (always safe):**
```ts
import { readPath } from "../../primitives/read.js";    // ✅ primitives are OK
import { writePath } from "../../primitives/write.js";   // ✅
import { recall } from "../../primitives/recall.js";     // ✅
```

**The only safe top-level imports are:**
- `import type { Tool } from "../../core/tools.js"` — type-only, no runtime
- `import { ... } from "../../primitives/xxx.js"` — primitives are designed for this
- `import { ... } from "fs/promises"` — Node.js built-ins
- `import { ... } from "path"` — Node.js built-ins

Everything else → dynamic import inside handler.

## Tips

- Keep tools small. One file, one tool, one purpose.
- Use primitives (read/write/recall/think) rather than raw Node.js APIs
  where possible — they are already bounded to your world.
- If a tool needs an API key, read it from `process.env` and return a
  helpful error message if it's missing.
- Give the tool a clear `description` — that's how you (the LLM) know
  when to call it. Write it for yourself.
- Test your tool by calling it once after creating it. If it errors, read
  the error and fix the import path.
