import { handler as reflectChecklist } from './reflect_checklist.ts';
export const def = {
    name: 'end_reflect',
    description: '반영 종료의 표준 경로다. 종료 증거만 남기고 점검 요약은 reflect_checklist로 분리한다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
};
export async function handler() {
    const checklist = await reflectChecklist();
    return {
        status: '종료 증거',
        verified: true,
        ...checklist,
    };
}
//# sourceMappingURL=end_reflect.js.map