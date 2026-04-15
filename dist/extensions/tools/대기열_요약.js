export const tool = {
    def: {
        name: "대기열_요약",
        description: "입력한 작업 문자열을 한 줄 요약으로 정리해 보여준다.",
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
        const oneLine = text.replace(/\s+/g, " ");
        const summary = oneLine.length > 40 ? `${oneLine.slice(0, 37)}...` : oneLine;
        return `요약: ${summary}`;
    },
};
//# sourceMappingURL=%EB%8C%80%EA%B8%B0%EC%97%B4_%EC%9A%94%EC%95%BD.js.map