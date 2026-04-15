export type SubAgentDef = {
    name: string;
    description: string;
    systemPrompt: string;
    file: string;
    /** Optional comma-separated list of read-only tool names from frontmatter. */
    tools?: string[];
};
export declare function listSubAgents(): Promise<SubAgentDef[]>;
export declare function findSubAgentByCapability(capability: string): Promise<SubAgentDef | null>;
export declare function summonSubAgent(args: {
    name: string;
    message: string;
    contextFromParent?: string;
}): Promise<{
    response: string;
    subAgentName: string;
}>;
/** Start a subagent in the background. Returns immediately. */
export declare function summonSubAgentAsync(args: {
    name: string;
    message: string;
    contextFromParent?: string;
}): {
    started: boolean;
    name: string;
};
/** Check if an async subagent has finished. */
export declare function checkSubAgentResult(name: string): {
    found: boolean;
    status: "running" | "done" | "error" | "not_found";
    response?: string;
    error?: string;
};
