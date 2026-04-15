import type { Tool } from "./tools.js";
export type LoadedExtension = {
    name: string;
    file: string;
    tools: Tool[];
    error?: string;
};
export declare function loadExtensionTools(): Promise<LoadedExtension[]>;
export declare function extensionsSummary(loaded: LoadedExtension[]): string;
