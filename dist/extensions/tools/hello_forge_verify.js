import { tool as helloForge } from "./hello_forge.ts";
import { tool as helloForgeTest } from "./hello_forge_test.ts";
import { tool as helloForgePairTest } from "./hello_forge_pair_test.ts";
import { tool as helloForgeSuite } from "./hello_forge_suite.ts";
export const tool = {
    def: {
        name: "hello_forge_verify",
        description: "hello_forge 계열 도구들을 한 번에 검증하는 공통 검증기다.",
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
        const results = [
            ["hello_forge", await helloForge.handler({ name })],
            ["hello_forge_test", await helloForgeTest.handler({ name })],
            ["hello_forge_pair_test", await helloForgePairTest.handler({ name })],
            ["hello_forge_suite", await helloForgeSuite.handler({ name })],
        ];
        const failures = results.filter(([, out]) => String(out).startsWith("실패:"));
        if (failures.length > 0) {
            return `실패: ${failures.map(([k, v]) => `${k}=${String(v)}`).join(" | ")}`;
        }
        return `통과: ${results.map(([k, v]) => `${k}=${String(v)}`).join(" | ")}`;
    },
};
//# sourceMappingURL=hello_forge_verify.js.map