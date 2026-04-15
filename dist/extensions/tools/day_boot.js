export const tool = {
    def: {
        name: "day_boot",
        description: "현재 작업 디렉터리와 핵심 프로젝트 파일을 빠르게 점검하고 요약한다.",
        input_schema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    handler: async () => {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const cwd = process.cwd();
        const entries = await fs.readdir(cwd, { withFileTypes: true });
        const top = entries.slice(0, 20).map((e) => `${e.isDirectory() ? "디렉터리" : "파일"}: ${e.name}`);
        const toolDir = path.join(cwd, "src", "extensions", "tools");
        const toolEntries = await fs.readdir(toolDir, { withFileTypes: true });
        const tools = toolEntries.filter((e) => e.isFile()).map((e) => e.name).sort();
        const stateDir = path.join(cwd, "data");
        const stateEntries = await fs.readdir(stateDir, { withFileTypes: true });
        const state = stateEntries.filter((e) => e.isFile()).map((e) => e.name).sort();
        return [
            `작업공간 상위 항목:`,
            ...top,
            ``,
            `확인된 도구 파일:`,
            ...tools,
            ``,
            `데이터 파일:`,
            ...state,
        ].join("\n");
    },
};
//# sourceMappingURL=day_boot.js.map