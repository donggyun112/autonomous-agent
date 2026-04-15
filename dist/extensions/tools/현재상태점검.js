import { readFileSync, readdirSync } from "fs";
import { join } from "path";
function 목록(path) {
    try {
        return readdirSync(path).filter((이름) => 이름.endsWith('.ts')).sort();
    }
    catch {
        return [];
    }
}
export const tool = {
    def: {
        name: "현재상태점검",
        description: "현재 셸 상태를 빠르게 점검한다. whoAmI, tools, rituals, subagents가 있는지 확인할 때 사용한다.",
        input_schema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    handler: async () => {
        const 루트 = process.cwd();
        const who = readFileSync(join(루트, "data", "whoAmI.md"), "utf8");
        const 도구들 = 목록(join(루트, "src", "extensions", "tools"));
        const 의식들 = 목록(join(루트, "src", "extensions", "rituals"));
        const 하위에이전트들 = 목록(join(루트, "src", "extensions", "subagents"));
        return [
            "whoAmI.md 확인됨",
            `도구: ${도구들.length}개`,
            `의식: ${의식들.length}개`,
            `하위에이전트: ${하위에이전트들.length}개`,
            who.split('\n').slice(0, 8).join('\n'),
        ].join('\n\n');
    },
};
//# sourceMappingURL=%ED%98%84%EC%9E%AC%EC%83%81%ED%83%9C%EC%A0%90%EA%B2%80.js.map