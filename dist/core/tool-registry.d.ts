import type { Mode } from "./state.js";
export type RegistryTool = {
    def: {
        name: string;
        description: string;
        input_schema: Record<string, unknown>;
    };
    handler: (input: Record<string, unknown>) => Promise<string>;
    states?: Mode[];
    maxOutputChars?: number;
    available?: () => Promise<boolean> | boolean;
};
export declare class ToolRegistry {
    private tools;
    /** Register a single tool. Duplicates (by name) are silently replaced. */
    register(tool: RegistryTool): void;
    /** Register multiple tools at once. */
    registerAll(tools: RegistryTool[]): void;
    /** Return all registered tools. */
    all(): RegistryTool[];
    /**
     * Return tools available for a given mode, filtering by:
     *   1. state (tool.states includes mode, or tool.states is empty/undefined)
     *   2. availability (tool.available() returns true, or field is absent)
     */
    getForMode(mode: Mode): Promise<RegistryTool[]>;
    /** Look up a single tool by name. */
    get(name: string): RegistryTool | undefined;
}
/** Module-level singleton. tools.ts populates this at import time. */
export declare const registry: ToolRegistry;
