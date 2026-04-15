export declare function reconstitute(): Promise<string>;
export declare function revise(args: {
    newText: string;
    reason: string;
}): Promise<{
    snapshotPath: string;
    warnings?: string[];
}>;
export type DriftReport = {
    score: number;
    level: "still" | "growing" | "shifting" | "drifting" | "estranged";
    comparedAgainst: string;
    comparedAgainstAge: string;
};
export declare function measureDrift(against?: "earliest" | "previous" | "midway"): Promise<DriftReport | null>;
export declare function birth(seedName: string): Promise<void>;
