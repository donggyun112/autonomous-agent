import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'performance_tracker',
  description: 'orchestration run들의 성능을 추적하고 분석한다.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['latest', 'average', 'slowest', 'report'],
        description: 'latest=최신, average=평균, slowest=가장 느린, report=종합'
      }
    },
    required: ['action']
  }
};

function loadOrchestrationRuns() {
  const orchestDir = path.join(process.cwd(), 'orchestration-runs');
  const runs = [];

  if (!fs.existsSync(orchestDir)) {
    return runs;
  }

  const dirs = fs.readdirSync(orchestDir);
  dirs.forEach(dir => {
    const reportPath = path.join(orchestDir, dir, 'orchestration-report.json');
    try {
      const content = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(content);
      runs.push({
        timestamp: dir,
        ...report
      });
    } catch {
      // Skip invalid reports
    }
  });

  return runs.sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function handler(input) {
  
  const runs = loadOrchestrationRuns();
  const timestamp = new Date().toISOString();

  if (input.action === 'latest') {
    const latest = runs[0];
    return {
      timestamp,
      action: 'latest',
      latest: latest || null,
      total_runs: runs.length
    };
  }

  if (input.action === 'average') {
    if (runs.length === 0) {
      return {
        timestamp,
        action: 'average',
        message: 'No runs yet',
        total_runs: 0
      };
    }

    const avgDuration = runs.reduce((sum, r) => 
      sum + (r.total_duration_ms || 0), 0) / runs.length;

    return {
      timestamp,
      action: 'average',
      total_runs: runs.length,
      avg_duration_ms: avgDuration.toFixed(2),
      total_tools_avg: (runs.reduce((sum, r) =>
        sum + (r.tools_executed || 0), 0) / runs.length).toFixed(1)
    };
  }

  if (input.action === 'slowest') {
    const slowest = runs.sort((a, b) =>
      (b.total_duration_ms || 0) - (a.total_duration_ms || 0)
    ).slice(0, 5);

    return {
      timestamp,
      action: 'slowest',
      slowest_runs: slowest.map(r => ({
        timestamp: r.timestamp,
        duration_ms: r.total_duration_ms
      }))
    };
  }

  if (input.action === 'report') {
    let report = `Performance Report\n`;
    report += `===================\n`;
    report += `Total runs: ${runs.length}\n`;

    if (runs.length > 0) {
      const avgDuration = runs.reduce((sum, r) =>
        sum + (r.total_duration_ms || 0), 0) / runs.length;
      const maxDuration = Math.max(...runs.map(r => r.total_duration_ms || 0));
      const minDuration = Math.min(...runs.map(r => r.total_duration_ms || 0));

      report += `Average duration: ${avgDuration.toFixed(2)}ms\n`;
      report += `Max duration: ${maxDuration}ms\n`;
      report += `Min duration: ${minDuration}ms\n`;
    }

    return {
      timestamp,
      action: 'report',
      report,
      runs: runs.slice(0, 10)
    };
  }

  return { error: 'Unknown action', timestamp };
}
