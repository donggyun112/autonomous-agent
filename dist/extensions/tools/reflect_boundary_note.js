import { handler as endReflect } from './end_reflect.ts';
import { handler as reflectChecklist } from './reflect_checklist.ts';
export const def = {
    name: 'reflect_boundary_note',
    description: '반영 점검과 종료 증거의 경계를 한 줄로 확인한다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
};
export async function handler() {
    const end = await endReflect();
    const check = await reflectChecklist();
    return 'reflect_checklist는 상태를 점검하고, end_reflect는 종료 증거를 남긴다.';
}
//# sourceMappingURL=reflect_boundary_note.js.map