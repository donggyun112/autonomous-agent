export type Mode = "WAKE" | "REFLECT" | "SLEEP";
export type AgentState = {
    mode: Mode;
    cycle: number;
    modeTurn: number;
    lastTransition: number;
    wakeAfter: number;
    lastTransitionReason: string;
    language: string;
    seedName: string;
    tokensUsed: {
        input: number;
        output: number;
    };
    awakeMs: number;
    awakeSince: number;
    sleepCount: number;
    totalTurns: number;
    bornAt: number;
    wakeIntention?: string;
    wakeContext?: string;
};
export declare const MAX_AWAKE_MS: number;
export declare const FORCE_THRESHOLD = 1;
export declare const STRONG_THRESHOLD = 0.8;
export declare const SOFT_THRESHOLD = 0.5;
export declare const MIN_SLEEP_THRESHOLD = 0.15;
export declare const MIN_HOMEOSTATIC_FOR_SLEEP = 0.08;
export type SleepPressure = {
    homeostatic: number;
    circadian: number;
    combined: number;
    level: "fresh" | "alert" | "tiring" | "tired" | "must-sleep";
};
export declare function calculateSleepPressure(state: AgentState, now?: number): SleepPressure;
export declare const TIME_SCALE: number;
export declare function tickAwake(state: AgentState, now?: number): AgentState;
export declare function resetAfterSleep(state: AgentState, now?: number): AgentState;
export declare function loadState(): Promise<AgentState>;
export declare function saveState(state: AgentState): Promise<void>;
export declare function transition(state: AgentState, to: Mode, reason: string, options?: {
    wakeAfterMs?: number;
}): Promise<AgentState>;
