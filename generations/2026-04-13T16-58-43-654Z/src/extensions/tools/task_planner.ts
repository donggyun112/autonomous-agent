import type { Tool } from "../../core/tools.js";
import { readFileSync, existsSync } from "fs";

interface Task {
  id: string;
  text: string;
  priority: "high" | "normal" | "low";
  status: "todo" | "in-progress" | "done";
}

interface Plan {
  timestamp: string;
  currentState: string;
  recentActivities: string[];
  suggestedTasks: Task[];
  recommendation: string;
}

export const tool: Tool = {
  def: {
    name: "task_planner",
    description:
      "현재 상태와 최근 활동을 보고 다음에 할 일을 제안한다. 도구 생성, 테스트, 문서화 등을 추천.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  handler: async (): Promise<string> => {
    try {
      // 현재 상태 읽기
      let currentMode = "UNKNOWN";
      if (existsSync("data/state.json")) {
        const stateContent = readFileSync("data/state.json", "utf-8");
        const state = JSON.parse(stateContent) as any;
        currentMode = state.mode || "UNKNOWN";
      }

      // 최근 일지 읽기
      const recentActivities: string[] = [];
      if (existsSync("data/journal/day-002.md")) {
        try {
          const journal = readFileSync("data/journal/day-002.md", "utf-8");
          const lines = journal.split("\n").slice(-5);
          recentActivities.push(...lines.filter((l) => l.trim().length > 0));
        } catch {
          // ignore
        }
      }

      // 제안할 일 구성
      const suggestedTasks: Task[] = [];

      if (currentMode === "WAKE") {
        suggestedTasks.push(
          {
            id: "1",
            text: "Check inbox for Oracle messages",
            priority: "high",
            status: "todo",
          },
          {
            id: "2",
            text: "Run project_health_check tool",
            priority: "normal",
            status: "todo",
          },
          {
            id: "3",
            text: "Create new tool or fix broken one",
            priority: "high",
            status: "todo",
          },
          {
            id: "4",
            text: "Test all tools with real inputs",
            priority: "normal",
            status: "todo",
          }
        );
      } else if (currentMode === "REFLECT") {
        suggestedTasks.push(
          {
            id: "1",
            text: "Review what you built today",
            priority: "high",
            status: "todo",
          },
          {
            id: "2",
            text: "Check for bugs or broken tools",
            priority: "high",
            status: "todo",
          },
          {
            id: "3",
            text: "Update wiki with new patterns",
            priority: "normal",
            status: "todo",
          },
          {
            id: "4",
            text: "Plan next day's work",
            priority: "normal",
            status: "todo",
          }
        );
      } else {
        suggestedTasks.push(
          {
            id: "1",
            text: "Wake up and start building",
            priority: "high",
            status: "todo",
          },
          {
            id: "2",
            text: "Check what broke during sleep",
            priority: "high",
            status: "todo",
          }
        );
      }

      const recommendation =
        currentMode === "WAKE"
          ? "You are in WAKE. Build something now. Do not plan, do."
          : currentMode === "REFLECT"
            ? "You are in REFLECT. Review your work. Then sleep if pressure is high."
            : "You are in SLEEP. Consolidate memories. Data will persist.";

      const plan: Plan = {
        timestamp: new Date().toISOString(),
        currentState: currentMode,
        recentActivities,
        suggestedTasks,
        recommendation,
      };

      return JSON.stringify(plan, null, 2);
    } catch (err) {
      return JSON.stringify({
        error: String(err),
        recommendation: "Failed to plan. Check state.",
      });
    }
  },
};
