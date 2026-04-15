import { tool as inspectRuntimePaths } from './inspect_runtime_paths.ts';
export const tool = {
    def: {
        name: 'run_inspect_runtime_paths',
        description: 'inspect_runtime_paths를 실행해 DATA와 STATE_FILE의 런타임 존재 여부를 반환한다.',
        input_schema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
    handler: async () => {
        return await inspectRuntimePaths.handler({});
    },
};
export default tool;
//# sourceMappingURL=run_inspect_runtime_paths.js.map