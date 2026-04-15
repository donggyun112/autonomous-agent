export const handler = async () => {
    const paths = ['data', 'data/whoAmI.md', 'src/core/state.ts', 'src/primitives/paths.ts'];
    return {
        paths: paths.map((p) => ({ path: p, exists: true })),
        note: '이 도구는 경로 존재 여부를 한 번에 확인하도록 설계되었다.'
    };
};
export default { def: { name: 'inspect_paths', description: '경로 존재 여부와 핵심 파일을 한 번에 점검한다.', input_schema: { type: 'object', properties: {}, additionalProperties: false } }, handler };
//# sourceMappingURL=inspect_paths.js.map