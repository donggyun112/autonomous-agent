import { tool as helloForge } from "./hello_forge.ts";
import { tool as helloForgeTest } from "./hello_forge_test.ts";
export const tool = {
    def: {
        name: "hello_forge_pair_test",
        description: "hello_forge와 hello_forge_test가 서로 일치하는 계약을 지키는지 확인한다.",
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
        const hello = await helloForge.handler({ name });
        const smoke = await helloForgeTest.handler({ name });
        const expected = `안녕, ${name}. 나는 정상적으로 깨어 있다.`;
        if (hello !== expected)
            return `실패: hello_forge 불일치. 기대="${expected}" 실제="${String(hello)}"`;
        if (!String(smoke).startsWith("통과:"))
            return `실패: hello_forge_test 불일치. 실제="${String(smoke)}"`;
        return `통과: 두 도구가 같은 계약을 지킨다.`;
    },
};
//# sourceMappingURL=hello_forge_pair_test.js.map