import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'action_log_parser',
  description: 'action log를 파싱하고 패턴을 분석한다.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['parse', 'frequency', 'errors'],
        description: 'parse=로그 파싱, frequency=행동 빈도, errors=오류 분석'
      },
      limit: {
        type: 'number',
        description: '분석할 최근 항목 수 (기본: 100)'
      }
    },
    required: ['action']
  }
};

function readActionLog() {
  const logDir = path.join(process.cwd(), 'action-log');
  const entries = [];

  if (!fs.existsSync(logDir)) {
    return entries;
  }

  const files = fs.readdirSync(logDir).sort().reverse();
  files.forEach(file => {
    const filePath = path.join(logDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);
        } catch {
          // Invalid JSON, skip
        }
      });
    } catch {
      // File read error
    }
  });

  return entries;
}

export function handler(input) {
  const entries = readActionLog();
  const limit = input.limit || 100;
  const recentEntries = entries.slice(0, limit);
  const timestamp = new Date().toISOString();

  if (input.action === 'parse') {
    return {
      timestamp,
      action: 'parse',
      total_entries: entries.length,
      parsed: recentEntries.length,
      entries: recentEntries.slice(0, 20)
    };
  }

  if (input.action === 'frequency') {
    const frequency = {};
    const statusCount = {};

    recentEntries.forEach(entry => {
      if (entry.tool) {
        frequency[entry.tool] = (frequency[entry.tool] || 0) + 1;
      }

      if (entry.status) {
        statusCount[entry.status] = (statusCount[entry.status] || 0) + 1;
      }
    });

    const topTools = Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, count]) => ({ tool, count }));

    return {
      timestamp,
      action: 'frequency',
      total_entries: recentEntries.length,
      top_tools: topTools,
      status_distribution: statusCount
    };
  }

  if (input.action === 'errors') {
    const errors = recentEntries.filter(e => e.status !== 'success' && e.status !== 'ok');
    const errorTypes = {};

    errors.forEach(e => {
      const type = e.error_type || 'unknown';
      errorTypes[type] = (errorTypes[type] || 0) + 1;
    });

    return {
      timestamp,
      action: 'errors',
      total_entries: recentEntries.length,
      error_count: errors.length,
      error_rate: (errors.length / recentEntries.length * 100).toFixed(2) + '%',
      error_types: errorTypes,
      recent_errors: errors.slice(0, 5)
    };
  }

  return { error: 'Unknown action', timestamp };
}
