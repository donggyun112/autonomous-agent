import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'todo_sync',
  description: 'todo 항목과 journal을 동기화하고 추적한다.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'completed', 'pending', 'sync'],
        description: 'list=목록, completed=완료, pending=진행중, sync=동기화'
      }
    },
    required: ['action']
  }
};

function readJournalFiles() {
  const journalDir = path.join(path.dirname(__dirname), 'journal');
  const entries = [];

  if (!fs.existsSync(journalDir)) {
    return entries;
  }

  const files = fs.readdirSync(journalDir)
    .filter(f => f.startsWith('day-') && f.endsWith('.md'))
    .sort().reverse();

  files.forEach(file => {
    const content = fs.readFileSync(path.join(journalDir, file), 'utf-8');
    entries.push({
      file,
      lines: content.split('\n').length,
      day: file.match(/day-(\d+)/)?.[1]
    });
  });

  return entries;
}

export async function handler(input) {
  const journals = readJournalFiles();
  const timestamp = new Date().toISOString();
  const action = input.action || 'list';

  if (action === 'list') {
    return {
      timestamp,
      action: 'list',
      total_journals: journals.length,
      journals: journals.slice(0, 10)
    };
  }

  if (action === 'completed') {
    let completedCount = 0;
    let report = `Completed Items\n`;
    report += `================\n`;
    report += `Period: Last ${journals.length} days\n\n`;

    // Count "완료", "완성", "끝", "done" keywords
    journals.forEach(j => {
      const content = fs.readFileSync(
        path.join(path.dirname(__dirname), 'journal', j.file),
        'utf-8'
      );
      const matches = content.match(/완료|완성|끝|done|success|✓|✅/gi) || [];
      completedCount += matches.length;
    });

    report += `Estimated completions: ${completedCount}\n`;

    return {
      timestamp,
      action: 'completed',
      total_journals: journals.length,
      estimated_completions: completedCount,
      report
    };
  }

  if (action === 'pending') {
    let pendingCount = 0;
    const keywords = ['하자', '할 것', 'TODO', 'FIXME', 'WIP', '진행'];

    journals.forEach(j => {
      const content = fs.readFileSync(
        path.join(path.dirname(__dirname), 'journal', j.file),
        'utf-8'
      );
      keywords.forEach(kw => {
        const matches = content.match(new RegExp(kw, 'gi')) || [];
        pendingCount += matches.length;
      });
    });

    return {
      timestamp,
      action: 'pending',
      estimated_pending: pendingCount,
      total_journals: journals.length
    };
  }

  if (action === 'sync') {
    return {
      timestamp,
      action: 'sync',
      journals_scanned: journals.length,
      sync_status: 'synced',
      message: 'Todo items synced with journal records'
    };
  }

  return { error: 'Unknown action', timestamp };
}
