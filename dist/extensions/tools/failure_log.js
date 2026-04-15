import fs from "fs";
import path from "path";
export const tool = {
    def: {
        name: "failure_log",
        description: "Log and analyze system failures. Not for self-reflection. For system improvement. When tools fail, this records why and how, so patterns can be learned.",
        input_schema: {
            type: "object",
            properties: {
                failure_type: {
                    type: "string",
                    enum: ["tool_error", "tool_timeout", "tool_crash", "logic_error", "data_error"],
                    description: "Category of failure",
                },
                tool_name: {
                    type: "string",
                    description: "Which tool failed",
                },
                error_message: {
                    type: "string",
                    description: "What the error was",
                },
                context: {
                    type: "string",
                    description: "What was being attempted",
                },
                severity: {
                    type: "string",
                    enum: ["critical", "high", "medium", "low"],
                    description: "How bad was this failure",
                },
            },
            required: ["failure_type", "tool_name", "error_message", "severity"],
        },
    },
    handler: async (input) => {
        const failureRecord = {
            timestamp: new Date().toISOString(),
            day: 5,
            moment: Math.floor(Math.random() * 200),
            failure_type: String(input.failure_type ?? "unknown"),
            tool_name: String(input.tool_name ?? "unknown"),
            error_message: String(input.error_message ?? "no message"),
            context: String(input.context ?? "unknown context"),
            severity: String(input.severity ?? "medium"),
            recovered: false,
            lesson: null,
        };
        // Attempt to append to failure log
        const logPath = path.join(process.cwd(), "data", "failures.jsonl");
        try {
            const logEntry = JSON.stringify(failureRecord) + "\n";
            fs.appendFileSync(logPath, logEntry, "utf-8");
            return `Failure recorded: ${failureRecord.tool_name} (${failureRecord.severity})`;
        }
        catch (e) {
            return `Could not write failure log: ${String(e)}`;
        }
    },
};
//# sourceMappingURL=failure_log.js.map