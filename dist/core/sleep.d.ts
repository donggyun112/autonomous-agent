export type SleepReport = {
    memoriesIngested: number;
    dreamed: number;
    schemasFormed: number;
    associationsFound: number;
    pruned: number;
    whoAmIUpdated: boolean;
    wikiPagesTouched: number;
    wikiLintFindings: number;
    selfPageSynced: boolean;
    entityPagesCreated: number;
    durationMs: number;
    errors: Array<{
        step: string;
        message: string;
    }>;
};
export declare function runSleepConsolidation(): Promise<SleepReport>;
