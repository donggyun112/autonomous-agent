import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'ritual_executor',
  description: '정의된 ritual들을 관리하고 실행 상태를 추적한다.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'status'],
        description: 'list=ritual 목록, read=ritual 읽기, status=실행 상태'
      },
      ritual: {
        type: 'string',
        description: 'action=read일 때 ritual 이름'
      }
    },
    required: ['action']
  }
};

function getRituals() {
  const ritualsDir = path.join(path.dirname(__dirname), 'src', 'extensions', 'rituals');
  const rituals = [];

  if (!fs.existsSync(ritualsDir)) {
    return rituals;
  }

  const files = fs.readdirSync(ritualsDir).filter(f => f.endsWith('.md'));
  files.forEach(file => {
    const content = fs.readFileSync(path.join(ritualsDir, file), 'utf-8');
    rituals.push({
      name: file.replace('.md', ''),
      file,
      lines: content.split('\n').length,
      size: content.length
    });
  });

  return rituals.sort((a, b) => a.name.localeCompare(b.name));
}

export function handler(input) {
  return (async () => {
  const rituals = getRituals();
  const timestamp = new Date().toISOString();
  const action = input.action || 'list';

  if (action === 'list') {
    return {
      timestamp,
      action: 'list',
      total_rituals: rituals.length,
      rituals: rituals.map(r => ({ name: r.name, lines: r.lines }))
    };
  }

  if (action === 'read' && input.ritual) {
    const ritual = rituals.find(r => r.name === input.ritual);
    if (!ritual) {
      return {
        timestamp,
        action: 'read',
        ritual: input.ritual,
        status: 'not_found'
      };
    }

    const ritualsDir = path.join(path.dirname(__dirname), 'src', 'extensions', 'rituals');
    const content = fs.readFileSync(path.join(ritualsDir, ritual.file), 'utf-8');

    return {
      timestamp,
      action: 'read',
      ritual: input.ritual,
      content: content.slice(0, 500),
      size: content.length,
      full_size: ritual.size
    };
  }

  if (action === 'status') {
    let executed = 0;
    let pending = 0;

    rituals.forEach(r => {
      // Simple heuristic: larger rituals are likely executed
      if (r.size > 200) executed++;
      else pending++;
    });

    return {
      timestamp,
      action: 'status',
      total_rituals: rituals.length,
      likely_executed: executed,
      pending: pending,
      status: executed > pending ? 'healthy' : 'needs_work'
    };
  }

  return { error: 'Unknown action', timestamp };
  })();
}
