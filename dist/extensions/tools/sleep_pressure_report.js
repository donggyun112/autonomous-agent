import { readFile } from "fs/promises";
import { calculateSleepPressure, loadState } from "../../core/state.ts";
export const tool = {
    def: {
        name: "sleep_pressure_report",
        description: "현재 상태 파일을 읽어 수면 압력과 시간 축의 핵심 값을 한 번에 보여준다.",
        input_schema: {
            type: "object",
            properties: {
                now: { type: "number", description: "선택적 기준 시각(epoch ms)" },
            },
            required: [],
        },
    },
    handler: async (input) => {
        const now = typeof input.now === "number" ? input.now : Date.now();
        const state = await loadState();
        const pressure = calculateSleepPressure(state, now);
        const text = await readFile("data/state.json", "utf-8").catch(() => "{}");
        return [
            `mode=${state.mode}`,
            `awakeMs=${state.awakeMs}`,
            `awakeSince=${state.awakeSince}`,
            `bornAt=${state.bornAt}`,
            `TIME_SCALE=${process.env.TIME_SCALE ?? "1"}`,
            `homeostatic=${pressure.homeostatic.toFixed(3)}`,
            `circadian=${pressure.circadian.toFixed(3)}`,
            `combined=${pressure.combined.toFixed(3)}`,
            `level=${pressure.level}`,
            `state=${text.trim()}`,
        ].join("\n");
    },
};
//# sourceMappingURL=sleep_pressure_report.js.map