import { type ThinkEventSink } from "../llm/client.js";
import { type AgentState, type Mode, type SleepPressure } from "./state.js";
import { type SleepReport } from "./sleep.js";
export type CycleResult = {
    state: AgentState;
    turns: number;
    reason: "transitioned" | "rested" | "turn_budget" | "slept";
    toolCalls: number;
    sleepReport?: SleepReport;
    pressure?: SleepPressure;
};
export type CycleObserver = {
    onLLMEvent?: ThinkEventSink;
    onToolStart?: (name: string, input: Record<string, unknown>) => void;
    onToolEnd?: (name: string, result: string) => void;
    onTurnStart?: (turn: number, mode: Mode) => void;
    onTurnEnd?: (turn: number) => void;
    onSessionRestore?: (messageCount: number) => void;
    onCompaction?: (result: {
        before: number;
        after: number;
    }) => void;
    onSleepStart?: () => void;
    onSleepEnd?: (report: SleepReport) => void;
    onExtensionLoad?: (count: number, errors: number) => void;
};
export declare function runCycle(options?: {
    maxTurns?: number;
    observer?: CycleObserver;
}): Promise<CycleResult>;
