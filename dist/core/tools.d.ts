import type { ToolDefinition, ToolCall } from "../llm/client.js";
import type { Mode } from "./state.js";
export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;
export type Tool = {
    def: ToolDefinition;
    handler: ToolHandler;
    states?: Mode[];
    maxOutputChars?: number;
    preserveOnCompact?: boolean;
    available?: () => Promise<boolean> | boolean;
};
export declare function resetActivatedTools(): void;
/** Dynamic list of extended tool names — used in system prompt and more_tools. */
export declare function extendedToolNames(): string[];
/**
 * Return tools available for a given mode.
 * On-demand loading: only core tools + activated extended tools are returned.
 * The agent uses `more_tools` to discover and activate the rest.
 */
export declare function toolsForMode(mode: Mode): Promise<Tool[]>;
/** Dispatch uses ALL tools (core + extended) so activated tools work. */
export declare function toolDefs(tools: Tool[]): ToolDefinition[];
export declare function isToolPreserved(name: string): boolean;
export declare function dispatchTool(tools: Tool[], call: ToolCall): Promise<{
    result: string;
    raw: string;
}>;
