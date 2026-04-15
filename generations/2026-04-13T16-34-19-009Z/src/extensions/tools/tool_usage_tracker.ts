import type { Tool } from "../../core/tools.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

interface ToolUsage {
  name: string;
  lastUsed: string | null;
  callCount: number;
  status: "active" | "dormant" | "unused";
}

interface UsageReport {
  timestamp: string;
  totalTools: number;
  activeTools: number;
  dormantTools: number;
  unusedTools: number;
  tools: ToolUsage[];
  recommendation: string;
}

const USAGE_LOG_FILE = "data/.tool-usage.json";

export const tool: Tool = {
  def: {
    name: "tool_usage_tracker",
    description:
      "도구 사용 현황을 추적한다. 각 도구의 마지막 사용 시간, 호출 횟수, 상태(active/dormant/unused)를 기록한다.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["report", "record", "reset"],
          description:
            "report: 현재 사용 현황 리포트, record: 도구 사용 기록, reset: 모든 기록 초기화. 기본값: report",
        },
        toolName: {
          type: "string",
          description: "action=record일 때, 기록할 도구 이름",
        },
      },
      required: [],
    },
  },

  handler: async (input: any): Promise<string> => {
    try {
      const action = (input?.action as string) || "report";
      const toolName = input?.toolName as string | undefined;

      // 기존 usage log 읽기 또는 새로 생성
      type UsageLog = Record<string, { lastUsed: string; callCount: number }>;
      let usageLog: UsageLog = {};
      if (existsSync(USAGE_LOG_FILE)) {
        const content = readFileSync(USAGE_LOG_FILE, "utf-8");
        usageLog = JSON.parse(content) as UsageLog;
      }

      if (action === "record" && toolName) {
        // 도구 사용 기록
        if (!usageLog[toolName]) {
          usageLog[toolName] = { lastUsed: "", callCount: 0 };
        }
        (usageLog[toolName] as { lastUsed: string; callCount: number }).lastUsed = new Date().toISOString();
        (usageLog[toolName] as { lastUsed: string; callCount: number }).callCount += 1;

        // 파일 저장
        mkdirSync(join(USAGE_LOG_FILE, ".."), { recursive: true });
        writeFileSync(USAGE_LOG_FILE, JSON.stringify(usageLog, null, 2));

        return JSON.stringify({
          action: "recorded",
          tool: toolName,
          callCount: usageLog[toolName].callCount,
          lastUsed: usageLog[toolName].lastUsed,
        });
      }

      if (action === "reset") {
        writeFileSync(USAGE_LOG_FILE, JSON.stringify({}, null, 2));
        return JSON.stringify({ action: "reset", message: "All usage records cleared" });
      }

      // action === "report"
      // 알려진 모든 도구의 목록을 가져온다 (src/extensions/tools 디렉토리 스캔)
      const { readdirSync, statSync } = await import("fs");
      const toolsDir = "src/extensions/tools";
      const entries = readdirSync(toolsDir);

      const tools: ToolUsage[] = [];
      let activeCount = 0;
      let dormantCount = 0;
      let unusedCount = 0;

      for (const entry of entries) {
        if (!entry.endsWith(".ts")) continue;

        const toolName = entry.replace(".ts", "");
        const usage = usageLog[toolName] as
          | { lastUsed: string; callCount: number }
          | undefined;

  let status: "active" | "dormant" | "unused" = "unused";
        if (usage) {
          const lastUsedTime = new Date(usage.lastUsed as string).getTime();
          const nowTime = Date.now();
          const daysSinceUsed = (nowTime - lastUsedTime) / (1000 * 60 * 60 * 24);

          if (daysSinceUsed < 1) {
            status = "active";
            activeCount += 1;
          } else if (daysSinceUsed < 7) {
            status = "dormant";
            dormantCount += 1;
          } else {
            status = "unused";
            unusedCount += 1;
          }
        } else {
          unusedCount += 1;
        }

        tools.push({
          name: toolName,
          lastUsed: usage?.lastUsed || null,
          callCount: usage?.callCount || 0,
          status,
        });
      }

      // 정렬: active > dormant > unused
      tools.sort((a, b) => {
        const statusOrder: Record<string, number> = { active: 0, dormant: 1, unused: 2 };
        return (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3);
      });

      let recommendation = "All tools are active. Good.";
      if (unusedCount > 0) {
        recommendation = `${unusedCount} tool(s) are unused. Consider removing or using them.`;
      }
      if (dormantCount > tools.length * 0.5) {
        recommendation = "More than half your tools are dormant. Focus or cleanup.";
      }

      const report: UsageReport = {
        timestamp: new Date().toISOString(),
        totalTools: tools.length,
        activeTools: activeCount,
        dormantTools: dormantCount,
        unusedTools: unusedCount,
        tools,
        recommendation,
      };

      return JSON.stringify(report, null, 2);
    } catch (err) {
      return JSON.stringify({
        error: String(err),
        recommendation: "Failed to track tool usage.",
      });
    }
  },
};
