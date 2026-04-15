import { type RunResult } from "../primitives/supervisor.js";
export type SimplicityDelta = {
    lineCountBefore: number;
    lineCountAfter: number;
    fileCountBefore: number;
    fileCountAfter: number;
    linesDelta: number;
    filesDelta: number;
    simpler: boolean;
};
type Health = {
    generationId: string;
    healthy: boolean;
    whoIAmAccordingToB: string;
    notes: string;
    reportedAt: string;
};
type SwapPending = {
    generationId: string;
    imageTag: string;
    previousTag: string;
    declaredAt: string;
    reason: string;
};
export type StageMoltArgs = {
    reason: string;
    patch?: Array<{
        relPath: string;
        content: string;
    }>;
    fromGeneration?: string;
};
export type StageResult = {
    generationId: string;
    generationDir: string;
    imageTag: string;
    filesPatched: string[];
    buildStdout: string;
    buildStderr: string;
};
export declare function stageMolt(args: StageMoltArgs): Promise<StageResult>;
export type TestMoltArgs = {
    generationId: string;
    overallTimeoutMs?: number;
    noOutputTimeoutMs?: number;
};
export type TestResult = {
    healthy: boolean;
    imageTag: string;
    health?: Health;
    run: RunResult;
    simplicity: SimplicityDelta;
};
export declare function testMolt(args: TestMoltArgs): Promise<TestResult>;
export type SwapArgs = {
    generationId: string;
    reason: string;
};
export type SwapResult = {
    ok: true;
    previousTag: string;
    newTag: string;
    generationId: string;
};
export declare function doSwap(args: SwapArgs): Promise<SwapResult>;
export declare function cleanupPendingSwapMarker(): Promise<void>;
export declare function readPendingSwap(): Promise<SwapPending | null>;
export declare function runSelfTest(generationId: string): Promise<void>;
export declare function runMockCycleTest(): Promise<void>;
/** Read the current consecutive-failure count (0 if no file). */
export declare function readMoltFailureCount(): Promise<number>;
/** Increment the consecutive-failure counter. Returns the new count. */
export declare function incrementMoltFailureCount(): Promise<number>;
/** Reset the failure counter (called on a successful cycle). */
export declare function resetMoltFailureCount(): Promise<void>;
/**
 * Roll back to the previous Docker image. Tags the previous image as
 * :current and writes a swap-pending marker so the daemon can exit and
 * let the host recreate the container.
 *
 * Returns null if no previous image is available.
 */
export declare function rollbackMolt(reason: string): Promise<SwapResult | null>;
export {};
