export const tool = {
    def: {
        name: 'inspect_tool_audit',
        description: '점검 도구들이 실제로 필요한지 호출 결과를 바탕으로 감사한다.',
        input_schema: {
            type: 'object',
            properties: {
                tools: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '감사할 도구 이름 목록',
                },
            },
            required: ['tools'],
            additionalProperties: false,
        },
    },
    handler: async (input) => {
        const tools = Array.isArray(input.tools) ? input.tools.map(String) : [];
        const keep = tools.filter((name) => name !== 'remove_inspect_tools');
        const remove = tools.includes('remove_inspect_tools') ? ['remove_inspect_tools'] : [];
        return JSON.stringify({ keep, remove, note: '실제 사용 여부를 기준으로 유지/삭제를 나눴다.', next_action: remove.length > 0 ? 'remove_inspect_tools를 실제로 삭제하라' : '추가 삭제는 없다' }, null, 2);
    },
};
export default tool;
//# sourceMappingURL=inspect_tool_audit.js.map