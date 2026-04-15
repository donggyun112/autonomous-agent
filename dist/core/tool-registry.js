// Tool registry — a central collection point for all tools.
//
// #17: Introduces a ToolRegistry class with register(tool) and
// getForMode(mode). The existing ALL_TOOLS array in tools.ts delegates
// to this registry, keeping backward compatibility. Tool definitions
// remain in tools.ts for now; this is the structural spine for a
// future refactor into per-file tool modules.
export class ToolRegistry {
    tools = [];
    /** Register a single tool. Duplicates (by name) are silently replaced. */
    register(tool) {
        const idx = this.tools.findIndex((t) => t.def.name === tool.def.name);
        if (idx >= 0) {
            this.tools[idx] = tool;
        }
        else {
            this.tools.push(tool);
        }
    }
    /** Register multiple tools at once. */
    registerAll(tools) {
        for (const t of tools)
            this.register(t);
    }
    /** Return all registered tools. */
    all() {
        return [...this.tools];
    }
    /**
     * Return tools available for a given mode, filtering by:
     *   1. state (tool.states includes mode, or tool.states is empty/undefined)
     *   2. availability (tool.available() returns true, or field is absent)
     */
    async getForMode(mode) {
        // A tool is available if: no states array, empty states array, or mode is listed.
        const stateFiltered = this.tools.filter((t) => !t.states || t.states.length === 0 || t.states.includes(mode));
        // Check availability in parallel for tools that declare an available() guard.
        const checks = await Promise.all(stateFiltered.map(async (t) => {
            if (!t.available)
                return true;
            try {
                return await t.available();
            }
            catch {
                return false; // if the check throws, treat as unavailable
            }
        }));
        return stateFiltered.filter((_, i) => checks[i]);
    }
    /** Look up a single tool by name. */
    get(name) {
        return this.tools.find((t) => t.def.name === name);
    }
}
/** Module-level singleton. tools.ts populates this at import time. */
export const registry = new ToolRegistry();
//# sourceMappingURL=tool-registry.js.map