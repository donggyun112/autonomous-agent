export type WakeCondition = {
    type: "inbox_reply";
} | {
    type: "wiki_count_exceeds";
    threshold: number;
};
export type ScheduledWake = {
    id: string;
    wakeAt: number;
    intention: string;
    context?: string;
    oneShot: boolean;
    intervalMs?: number;
    registeredAt: string;
    condition?: WakeCondition;
    priority?: number;
};
export declare function registerWake(wake: Omit<ScheduledWake, "id" | "registeredAt">): Promise<ScheduledWake>;
export declare function cancelWake(id: string): Promise<boolean>;
export declare function listWakes(): Promise<ScheduledWake[]>;
export declare function popDueWake(): Promise<ScheduledWake | null>;
export declare function parseWakeTime(input: string): number | null;
