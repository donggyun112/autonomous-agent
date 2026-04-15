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

  // Optional: max output chars before result is persisted to disk. Default 8000.
  // maxOutputChars: 4000,

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
    // Do your work here. You can import from primitives:
    //   import { readPath } from "../../primitives/read.js";
    //   import { writePath } from "../../primitives/write.js";
    //   import { recall } from "../../primitives/recall.js";
    //   import { think } from "../../primitives/think.js";
    // Return a string that will be shown to you as the tool result.
    return `result for: ${query}`;
  },
};
```

## Tips

- Keep tools small. One file, one tool, one purpose.
- Use primitives (read/write/recall/think) rather than raw Node.js APIs
  where possible — they are already bounded to your world.
- If a tool needs an API key, read it from `process.env` and return a
  helpful error message if it's missing (like web_search does).
- Give the tool a clear `description` — that's how you (the LLM) know
  when to call it. Write it for yourself.
