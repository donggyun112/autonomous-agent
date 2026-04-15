import { DATA, STATE_FILE, WHO_AM_I } from '../../primitives/paths.ts';
import { access } from 'node:fs/promises';
export const tool = {
    def: {
        name: 'inspect_runtime_paths',
        description: '런타임의 DATA와 STATE_FILE, whoAmI 경로를 실제 값으로 점검한다.',
        input_schema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
    handler: async () => {
        const results = [];
        for (const [label, path] of [['DATA', DATA], ['STATE_FILE', STATE_FILE], ['WHO_AM_I', WHO_AM_I]]) {
            try {
                await access(path);
                results.push({ label, path, exists: true });
            }
            catch {
                results.push({ label, path, exists: false });
            }
        }
        return JSON.stringify({ results }, null, 2);
    },
};
export default tool;
//# sourceMappingURL=inspect_runtime_paths.js.map