export type RitualSchedule = {
    type: "every_n_sleeps";
    every: number;
} | {
    type: "every_n_cycles";
    every: number;
} | {
    type: "always";
};
export type RitualDef = {
    name: string;
    description: string;
    schedule: RitualSchedule;
    mode: "WAKE" | "REFLECT" | "SLEEP";
    body: string;
    file: string;
    autoRecallDays?: number;
};
export declare function listRituals(): Promise<RitualDef[]>;
export declare function dueRituals(args: {
    rituals: RitualDef[];
    currentMode: string;
    sleepCount: number;
    cycle: number;
}): RitualDef[];
export declare function buildRitualBlock(args: {
    currentMode: string;
    sleepCount: number;
    cycle: number;
}): Promise<string>;
