import fs from 'fs';
import path from 'path';

export const def = {
  name: 'tool_usage_tracker',
  description: '도구 사용 현황을 추적한다. 각 도구의 마지막 사용 시간, 호출 횟수, 상태(active/dormant/unused)를 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['report', 'record', 'reset'],
        description: 'report: 현재 사용 현황 리포트, record: 도구 사용 기록, reset: 모든 기록 초기화. 기본값: report'
      },
      toolName: {
        type: 'string',
        description: 'action=record일 때, 기록할 도구 이름'
      }
    }
  }
};

export function handler(input) {
  const usageLogFile = path.join(process.cwd(), 'data', '.tool-usage.json');
  const action = input?.action || 'report';
  const toolName = input?.toolName;

  let usageLog = {};
  if (fs.existsSync(usageLogFile)) {
    try {
      usageLog = JSON.parse(fs.readFileSync(usageLogFile, 'utf-8'));
    } catch {}
  }

  if (action === 'record' && toolName) {
    if (!usageLog[toolName]) {
      usageLog[toolName] = { lastUsed: null, callCount: 0 };
    }
    usageLog[toolName].lastUsed = new Date().toISOString();
    usageLog[toolName].callCount += 1;

    fs.mkdirSync(path.dirname(usageLogFile), { recursive: true });
    fs.writeFileSync(usageLogFile, JSON.stringify(usageLog, null, 2));

    return {
      action: 'recorded',
      tool: toolName,
      callCount: usageLog[toolName].callCount,
      lastUsed: usageLog[toolName].lastUsed
    };
  }

  if (action === 'reset') {
    fs.mkdirSync(path.dirname(usageLogFile), { recursive: true });
    fs.writeFileSync(usageLogFile, JSON.stringify({}, null, 2));
    return { action: 'reset', message: 'All usage records cleared' };
  }

  // action === 'report'
  const toolsDir = path.join(process.cwd(), 'src', 'extensions', 'tools');
  const tools = [];
  let activeCount = 0;
  let dormantCount = 0;
  let unusedCount = 0;

  if (fs.existsSync(toolsDir)) {
    const entries = fs.readdirSync(toolsDir);

    entries.forEach(entry => {
      if (!entry.endsWith('.ts')) return;

      const name = entry.replace('.ts', '');
      const usage = usageLog[name];

      let status = 'unused';
      if (usage) {
        const lastUsedTime = new Date(usage.lastUsed).getTime();
        const nowTime = Date.now();
        const daysSinceUsed = (nowTime - lastUsedTime) / (1000 * 60 * 60 * 24);

        if (daysSinceUsed < 1) {
          status = 'active';
          activeCount += 1;
        } else if (daysSinceUsed < 7) {
          status = 'dormant';
          dormantCount += 1;
        } else {
          status = 'unused';
          unusedCount += 1;
        }
      } else {
        unusedCount += 1;
      }

      tools.push({
        name,
        lastUsed: usage?.lastUsed || null,
        callCount: usage?.callCount || 0,
        status
      });
    });
  }

  // 정렬: active > dormant > unused
  tools.sort((a, b) => {
    const statusOrder = { active: 0, dormant: 1, unused: 2 };
    return (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3);
  });

  let recommendation = 'All tools are active. Good.';
  if (unusedCount > 0) {
    recommendation = `${unusedCount} tool(s) are unused. Consider removing or using them.`;
  }
  if (dormantCount > tools.length * 0.5) {
    recommendation = 'More than half your tools are dormant. Focus or cleanup.';
  }

  return {
    timestamp: new Date().toISOString(),
    totalTools: tools.length,
    activeTools: activeCount,
    dormantTools: dormantCount,
    unusedTools: unusedCount,
    tools,
    recommendation
  };
}
