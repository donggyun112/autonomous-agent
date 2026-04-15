declare const SCOPES: {
    readonly subagent: {
        readonly dir: string;
        readonly description: "Sub-agent definitions (inner voices the agent can summon).";
    };
    readonly tool: {
        readonly dir: string;
        readonly description: "New tools built from the primitives.";
    };
    readonly ritual: {
        readonly dir: string;
        readonly description: "Rituals the agent gives itself (e.g. weekly self-question).";
    };
    readonly "state-prompt": {
        readonly dir: string;
        readonly description: "WAKE/REFLECT/DREAM prompts. base.md is excluded.";
    };
};
type Scope = keyof typeof SCOPES;
export type ManageSelfAction = {
    kind: "list";
    scope: Scope;
} | {
    kind: "read";
    scope: Scope;
    name: string;
} | {
    kind: "create";
    scope: Scope;
    name: string;
    content: string;
    reason: string;
} | {
    kind: "update";
    scope: Scope;
    name: string;
    content: string;
    reason: string;
} | {
    kind: "patch";
    scope: Scope;
    name: string;
    find: string;
    replace: string;
    reason: string;
} | {
    kind: "list_scopes";
};
export declare function manageSelf(action: ManageSelfAction): Promise<string>;
export {};
