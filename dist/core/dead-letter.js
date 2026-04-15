// Dead-letter queue — failed tool calls queued for retry.
import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";
const DLQ_FILE = join(DATA, "dead-letter.jsonl");
export async function enqueueFailed(entry) {
    await mkdir(DATA, { recursive: true });
    const full = { ...entry, id: `dlq-${Date.now().toString(36)}` };
    await appendFile(DLQ_FILE, JSON.stringify(full) + "\n", "utf-8");
}
export async function peekDeadLetter(limit = 10) {
    try {
        const text = await readFile(DLQ_FILE, "utf-8");
        return text.split("\n").filter((l) => l.trim())
            .map((l) => { try {
            return JSON.parse(l);
        }
        catch {
            return null;
        } })
            .filter((e) => e !== null)
            .slice(-limit);
    }
    catch {
        return [];
    }
}
export async function clearDeadLetterEntry(id) {
    try {
        const text = await readFile(DLQ_FILE, "utf-8");
        const lines = text.split("\n").filter((l) => l.trim());
        const filtered = lines.filter((l) => {
            try {
                return JSON.parse(l).id !== id;
            }
            catch {
                return true;
            }
        });
        if (filtered.length === lines.length)
            return false;
        // Atomic write via temp file + rename to avoid losing concurrent appends.
        const tmp = DLQ_FILE + ".tmp";
        await writeFile(tmp, filtered.join("\n") + "\n", "utf-8");
        const { rename } = await import("fs/promises");
        await rename(tmp, DLQ_FILE);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=dead-letter.js.map