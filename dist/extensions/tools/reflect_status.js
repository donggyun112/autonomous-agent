import { handler as reflectChecklist } from './reflect_checklist.ts';
export const def = {
    name: 'reflect_status',
    description: '반영 점검의 짧은 상태 요약을 반환한다. 종료 증거는 end_reflect를 사용한다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
};
export async function handler() {
    const checklist = await reflectChecklist();
    return {
        status: '점검 상태',
        root: checklist.root,
        data: checklist.data,
        src: checklist.src,
    };
}
//# sourceMappingURL=reflect_status.js.map