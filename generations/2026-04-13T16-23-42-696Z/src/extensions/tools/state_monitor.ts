import type { Tool } from "../../core/tools.js";
import { readFileSync } from "fs";
import { join } from "path";

interface StateSnapshot {
  timestamp: string;
  mode: string;
  awakeMs: number;
  pressure: {
    combined: number;
    homeostatic: number;
    interaction: number;
  };
  actions: number;
  errors: number;
  status: "normal" | "warning" | "critical";
  recommendation: string;
}

export const tool: Tool = {
  def: {
    name: "state_monitor",
    description:
      "현재 상태 파일(state.json)을 읽고 awake 시간, 압력, 행동 수를 모니터한다.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  handler: async (): Promise<string> => {
    try {
      const stateFile = "data/state.json";
      const content = readFileSync(stateFile, "utf-8");
      const state = JSON.parse(content) as any;

      const pressure = state.pressures || {};
      const combinedPressure = pressure.combined ?? 0;

      let status: "normal" | "warning" | "critical" = "normal";
      let recommendation = "Operating normally.";

      if (combinedPressure > 0.75) {
        status = "warning";
        recommendation = "Pressure is high. Consider sleeping soon.";
      }

      if (combinedPressure > 0.9) {
        status = "critical";
        recommendation = "CRITICAL: Must sleep immediately.";
      }

      if ((state.awakeMs || 0) > 3600000) {
        // > 1 hour
        status = "warning";
        recommendation = "Awake for over 1 hour. Long cycle.";
      }

      const snapshot: StateSnapshot = {
        timestamp: new Date().toISOString(),
        mode: state.mode || "unknown",
        awakeMs: state.awakeMs || 0,
        pressure: {
          combined: combinedPressure,
          homeostatic: pressure.homeostatic ?? 0,
          interaction: pressure.interaction ?? 0,
        },
        actions: state.actionCount || 0,
        errors: state.errorCount || 0,
        status,
        recommendation,
      };

      return JSON.stringify(snapshot, null, 2);
    } catch (err) {
      return JSON.stringify({
        error: String(err),
        status: "critical",
        recommendation: "Cannot read state.json. Check filesystem.",
      });
    }
  },
};
