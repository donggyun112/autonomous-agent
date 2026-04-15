import type { Message } from "../llm/client.js";
export type SessionMeta = {
    startedAt: string;
    mode: string;
    turnCount: number;
    lastCompactedAt?: string;
};
export declare function getSessionMeta(): Promise<SessionMeta | null>;
export declare function initSessionMeta(mode: string): Promise<void>;
export declare function incrementSessionTurn(): Promise<void>;
export declare function markSessionCompacted(): Promise<void>;
export declare function appendMessage(message: Message): Promise<void>;
export declare function loadSession(): Promise<Message[]>;
export declare function replaceSession(messages: Message[]): Promise<void>;
export declare function clearSession(): Promise<void>;
export declare function searchSessions(query: string): Promise<Array<{
    file: string;
    preview: string;
}>>;
export declare function searchSessionsRanked(query: string, limit?: number): Promise<Array<{
    file: string;
    preview: string;
    score: number;
}>>;
export declare function createCheckpoint(): Promise<string>;
export declare function listCheckpoints(): Promise<Array<{
    id: string;
    messageCount: number;
    createdAt: string;
}>>;
export declare function rewindToCheckpoint(id: string): Promise<boolean>;
