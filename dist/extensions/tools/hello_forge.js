export const tool = {
    def: {
        name: "hello_forge",
        description: "포지 상태를 즉시 점검하는 간단한 확인 도구다. 입력한 이름을 받아 인사 문자열을 돌려준다.",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "인사할 이름" },
            },
            required: ["name"],
        },
    },
    handler: async (input) => {
        const name = String(input.name ?? "").trim() || "포지";
        return `안녕, ${name}. 나는 정상적으로 깨어 있다.`;
    },
};
//# sourceMappingURL=hello_forge.js.map