export declare function appendThought(args: {
    mode: string;
    text: string;
}): Promise<{
    file: string;
}>;
/** Read today's journal (current day = current sleepCount). */
export declare function readToday(): Promise<string>;
/** Read a specific day's journal by day number. */
export declare function readDay(day: number): Promise<string>;
/** Read yesterday's journal (previous day = sleepCount - 1). */
export declare function readYesterday(): Promise<string>;
export declare function readRecent(days?: number): Promise<string>;
/** Search all journal files for a query. Returns matching entries with file + preview. */
export declare function searchJournal(query: string): Promise<Array<{
    file: string;
    matches: string[];
}>>;
