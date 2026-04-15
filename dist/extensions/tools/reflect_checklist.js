import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
function fmtSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    const units = ['KB', 'MB', 'GB'];
    let n = bytes / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i += 1;
    }
    return `${n.toFixed(1)}${units[i]}`;
}
async function listTop(dir, limit = 8) {
    const entries = await readdir(dir, { withFileTypes: true });
    const rows = [];
    for (const entry of entries.slice(0, limit)) {
        const full = join(dir, entry.name);
        const info = await stat(full);
        rows.push(`${entry.isDirectory() ? 'd' : '-'} ${entry.name} ${fmtSize(info.size)}`);
    }
    return rows;
}
export const def = {
    name: 'reflect_checklist',
    description: 'reflect 단계에서 data/와 src/의 핵심 파일 상태를 빠르게 점검한다. 종료 증거는 만들지 않는다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
};
export async function handler() {
    const root = await listTop('.');
    const data = await listTop('data');
    const src = await listTop('src');
    return {
        root: root.slice(0, 3),
        data: data.slice(0, 3),
        src: src.slice(0, 3),
    };
}
//# sourceMappingURL=reflect_checklist.js.map