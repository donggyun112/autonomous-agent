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
      "현재 상태 파일(state.json)을 읽고 awake 시간, 압력, 행동 수를 모니터한다. mode로 'current' 또는 'history' 선택 가능.",
    input_schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["current", "history"],
          description: "current=현재 상태, history=상태 변화 추적",
        },
      },
      required: [],
    },
  },

  handler: async (input): Promise<string> => {
    try {
      const mode = String(input.mode ?? "current");
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

      // mode: history - 상태 변화 분석
      if (mode === "history") {
        const analysis = {
          ...snapshot,
          trend: {
            pressure_direction: combinedPressure > 0.5 ? "increasing" : "stable",
            awake_time_minutes: Math.round((state.awakeMs || 0) / 1000 / 60),
            cycle: state.cycle || 0,
            turns_this_cycle: state.modeTurn || 0,
            sleep_count: state.sleepCount || 0,
          },
          history_note: "State monitored. Trend and cycle info available for planning.",
        };
        return JSON.stringify(analysis, null, 2);
      }

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
