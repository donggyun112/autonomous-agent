import { tool as helloForge } from "./hello_forge.ts";
export const tool = {
    def: {
        name: "hello_forge_test",
        description: "hello_forge 도구가 기대한 응답을 내는지 최소 스모크 테스트로 검증한다.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "테스트할 이름" },
            },
            required: ["name"],
        },
    },
    handler: async (input) => {
        const name = String(input.name ?? "").trim() || "포지";
        const result = await helloForge.handler({ name });
        const expected = `안녕, ${name}. 나는 정상적으로 깨어 있다.`;
        if (result !== expected) {
            return `실패: 기대값과 다름. 기대="${expected}" 실제="${String(result)}"`;
        }
        return `통과: ${expected}`;
    },
};
//# sourceMappingURL=hello_forge_test.js.map