import { tool as helloForge } from "./hello_forge.ts";
import { tool as helloForgeTest } from "./hello_forge_test.ts";
import { tool as helloForgePairTest } from "./hello_forge_pair_test.ts";
export const tool = {
    def: {
        name: "hello_forge_suite",
        description: "hello_forge 계열 셋을 연속으로 검증하는 최소 실행기다.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "검증할 이름" },
            },
            required: ["name"],
        },
    },
    handler: async (input) => {
        const name = String(input.name ?? "").trim() || "포지";
        const a = await helloForge.handler({ name });
        const b = await helloForgeTest.handler({ name });
        const c = await helloForgePairTest.handler({ name });
        return `실행완료: ${String(a)} | ${String(b)} | ${String(c)}`;
    },
};
//# sourceMappingURL=hello_forge_suite.js.map