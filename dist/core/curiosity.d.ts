export declare function randomMemoryStimulus(): Promise<string>;
export declare function loadCuriosityQuestion(): Promise<string>;
export declare function saveCuriosityQuestion(question: string): Promise<void>;
export declare function staleWikiStimulus(): Promise<string>;
export declare function behaviorBlindSpot(days?: number): Promise<string>;
export declare function toolUsageStats(days?: number): Promise<string>;
export declare function repeatedToolPatternCheck(days?: number): Promise<string>;
export declare function buildCuriosityBlocks(mode: string): Promise<string>;
