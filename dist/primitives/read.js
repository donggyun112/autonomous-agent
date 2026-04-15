// PRIMITIVE: read
//
// The agent may read any file on the filesystem. The world is open.
// Only credentials/secrets are blocked.
import { readFile, readdir, stat } from "fs/promises";
import { resolve } from "path";
const BLOCKED_PATTERNS = [".auth", "oauth.json", "credentials", ".ssh/id_"];
function isBlocked(path) {
    const lower = path.toLowerCase();
    return BLOCKED_PATTERNS.some((p) => lower.includes(p));
}
export async function readPath(path) {
    const abs = resolve(path);
    if (isBlocked(abs)) {
        throw new Error(`read: access denied — ${path} contains sensitive data.`);
    }
    const s = await stat(abs);
    if (s.isDirectory()) {
        const entries = await readdir(abs, { withFileTypes: true });
        return entries
            .map((e) => `${e.isDirectory() ? "[d]" : "   "} ${e.name}`)
            .join("\n");
    }
    return await readFile(abs, "utf-8");
}
export async function listDir(path) {
    const abs = resolve(path);
    if (isBlocked(abs)) {
        throw new Error(`list: access denied — ${path} contains sensitive data.`);
    }
    return await readdir(abs);
}
//# sourceMappingURL=read.js.map