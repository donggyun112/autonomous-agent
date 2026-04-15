import { tool as 대기열요약 } from "./대기열_요약.ts";
export const tool = {
    def: {
        name: "대기열_요약_test",
        description: "대기열_요약 도구가 기대한 응답을 내는지 최소 스모크 테스트로 검증한다.",
        input_schema: {
            type: "object",
            properties: {
                text: { type: "string", description: "요약할 작업 설명" },
            },
            required: ["text"],
        },
    },
    handler: async (input) => {
        const text = String(input.text ?? "").trim();
        if (!text)
            return "실패: 입력이 비어 있다.";
        const result = await 대기열요약.handler({ text });
        const expected = `요약: ${text.replace(/\s+/g, " ")}`;
        if (String(result).startsWith("요약:")) {
            return `통과: ${result}`;
        }
        return `실패: 기대값과 다름. 기대="${expected}" 실제="${String(result)}"`;
    },
};
//# sourceMappingURL=%EB%8C%80%EA%B8%B0%EC%97%B4_%EC%9A%94%EC%95%BD_test.js.map