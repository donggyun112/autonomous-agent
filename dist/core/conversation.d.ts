export type AskUserArgs = {
    question: string;
    reason: string;
    urgency?: "low" | "normal" | "high";
};
export type AskUserResult = {
    id: string;
    file: string;
    status: "pending";
};
export declare function askUser(args: AskUserArgs): Promise<AskUserResult>;
export type WriteLetterArgs = {
    text: string;
    title?: string;
};
export type WriteLetterResult = {
    id: string;
    file: string;
};
export declare function writeLetter(args: WriteLetterArgs): Promise<WriteLetterResult>;
export type InboxMessage = {
    id: string;
    file: string;
    receivedAt: string;
    content: string;
    inReplyTo?: string;
    replyToReason?: string;
};
export declare function checkInbox(options?: {
    includeAll?: boolean;
    markRead?: boolean;
}): Promise<InboxMessage[]>;
export declare function listPendingQuestions(): Promise<Array<{
    id: string;
    askedAt: string;
    reason: string;
    file: string;
}>>;
export declare function unreadInboxCount(): Promise<number>;
export declare function userReply(args: {
    inReplyTo?: string;
    text: string;
}): Promise<{
    id: string;
    file: string;
}>;
