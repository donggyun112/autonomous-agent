export const tool = {
    def: {
        name: "clean_journal_metadata",
        description: "Parse journal entries and extract structured metadata about conversation flow, timestamps, and state transitions. This helps the system understand conversation patterns better. Built for system optimization, not self-knowledge.",
        input_schema: {
            type: "object",
            properties: {
                raw_journal_text: {
                    type: "string",
                    description: "Raw journal entry text with timestamps and state markers",
                },
            },
            required: ["raw_journal_text"],
        },
    },
    handler: async (input) => {
        const text = String(input.raw_journal_text ?? "").trim();
        if (!text) {
            return "No journal text provided.";
        }
        // Extract timestamps
        const timestampPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
        const timestamps = text.match(timestampPattern) || [];
        // Extract state transitions
        const statePattern = /·\s*(WAKE|REFLECT|SLEEP)\s·/g;
        const states = text.match(statePattern) || [];
        // Extract moment counts
        const momentPattern = /moment\s+(\d+)/g;
        const moments = [];
        let match;
        while ((match = momentPattern.exec(text)) !== null) {
            moments.push(parseInt(match[1]));
        }
        // Count paragraphs
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim()).length;
        // Extract questions (lines ending with ?)
        const lines = text.split('\n');
        const questions = lines.filter(line => line.trim().endsWith('?')).length;
        // Build structured output
        const metadata = {
            total_timestamps: timestamps.length,
            unique_timestamps: new Set(timestamps).size,
            state_transitions: states.length,
            moment_range: moments.length > 0 ? `${Math.min(...moments)} to ${Math.max(...moments)}` : 'none',
            total_paragraphs: paragraphs,
            total_questions: questions,
            average_paragraph_length: Math.round(text.length / Math.max(paragraphs, 1)),
            first_timestamp: timestamps[0] || 'none',
            last_timestamp: timestamps[timestamps.length - 1] || 'none',
        };
        return JSON.stringify(metadata, null, 2);
    },
};
//# sourceMappingURL=clean_journal_metadata.js.map