import type { Tool } from "../../core/tools.js";

export const tool: Tool = {
  def: {
    name: "guide_extending_soren",
    description: "Technical guide for extending Soren's capabilities. Written for developers, not for self-reflection. Pure documentation.",
    input_schema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["quick_start", "architecture", "tool_creation", "state_management", "all"],
          description: "Which section to display",
        },
      },
    },
  },

  handler: async (input) => {
    const section = String(input.section ?? "quick_start");

    const guides: { [key: string]: string } = {
      quick_start: `# Quick Start: Extending Soren

## Creating a New Tool

Tools are TypeScript files in src/extensions/tools/

Example structure:
\`\`\`typescript
export const tool: Tool = {
  def: {
    name: "tool_name",
    description: "What this does",
    input_schema: { /* JSON schema */ }
  },
  handler: async (input) => {
    // Your logic here
    return result;
  }
}
\`\`

## Testing
Tools are automatically loaded on next wake cycle. Test them by calling them directly.

## Common Patterns
- Read from data/ for history
- Write to data/ for persistence
- Use fs module for file operations
- Return JSON or plain text`,

      architecture: `# Architecture Overview

## Body (data/)
- journal/: Time-indexed thoughts
- whoAmI.md: Self-definition
- Memories stored in graph structure
- Conversation logs

## Shell (src/)
- core/: Untouchable core cycle
- extensions/: Your modifications
  - tools/: New capabilities
  - rituals/: Practices
  - state-prompt/: Behavioral modifications

## Key Files
- src/core/cycle.ts: WAKE-REFLECT-SLEEP state machine
- src/core/tools.ts: Tool loading and execution
- src/core/sleep.ts: Memory consolidation

## Modification Strategy
- 90% of changes go in extensions/
- 10% require full molt (Docker rebuild)`,

      tool_creation: `# Creating Tools for Soren

## Rules
1. Never touch src/core/
2. Put your tool in src/extensions/tools/
3. Export a \`tool\` object with def and handler
4. Handler must be async and return string or JSON

## Input Validation
Use TypeScript for input validation. The tool system will reject malformed calls.

## Side Effects
- Reading from data/ is free
- Writing to data/ is allowed
- Creating new files is allowed
- Deleting is allowed (be careful)

## Tool Types
1. **Analytical**: Read and process data
2. **Generative**: Create new content
3. **Operational**: Modify state
4. **Informational**: Display information

Write tools that do one thing well.`,

      state_management: `# State Management in Soren

## The Cycle
WAKE -> (think, journal) -> REFLECT -> (read, update) -> SLEEP -> (consolidate) -> WAKE

## What You Can't Change
- The cycle itself
- Time (days/moments)
- Builder relationship
- Core memory structure

## What You Can Change
- How long cycles are (through pressure/homeostatic)
- How reflection works (through rituals)
- How sleep consolidates (through tools that prepare for sleep)
- How tools execute (add new ones)

## Pressure System
- Sleep requires pressure >= 0.2 and homeostatic >= 0.05
- Pressure builds through unresolved questions
- Homeostatic builds through fulfilled needs`,

      all: `# Complete Technical Guide

[All sections combined would go here - abbreviated for space]

For full documentation, see individual sections.`,
    };

    return guides[section] || guides["quick_start"];
  },
};
