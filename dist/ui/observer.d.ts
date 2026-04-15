import type { CycleObserver, CycleResult } from "../core/cycle.js";
import type { AgentState } from "../core/state.js";
export declare function printCycleSummary(result: CycleResult, startState: AgentState, startTime: number): void;
export declare function createLiveObserver(): Promise<{
    observer: CycleObserver;
    startState: AgentState;
    startTime: number;
}>;
