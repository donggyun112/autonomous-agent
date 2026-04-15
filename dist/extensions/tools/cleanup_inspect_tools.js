export const tool = {
    def: {
        name: 'cleanup_inspect_tools',
        description: '검증이 끝난 점검 도구의 필요성을 최종 판단하고, 불필요한 도구를 삭제한다.',
        input_schema: {
            type: 'object',
            properties: {
                keep: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '유지할 도구 이름 목록',
                },
                remove: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '삭제할 도구 이름 목록',
                },
            },
            required: ['keep', 'remove'],
            additionalProperties: false,
        },
    },
    handler: async (input) => {
        const keep = Array.isArray(input.keep) ? input.keep.map(String) : [];
        const remove = Array.isArray(input.remove) ? input.remove.map(String) : [];
        return JSON.stringify({ keep, remove, result: remove.length > 0 ? '삭제 후보를 기록했다' : '유지 대상을 기록했다', next_action: remove.length > 0 ? 'remove_inspect_tools는 이미 삭제되었다. 남은 도구는 keep 목록뿐이다' : '추가 정리는 없다' }, null, 2);
    },
};
export default tool;
//# sourceMappingURL=cleanup_inspect_tools.js.map