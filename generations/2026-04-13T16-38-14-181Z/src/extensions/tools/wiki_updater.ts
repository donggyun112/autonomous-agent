import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'wiki_updater',
  description: 'wiki 디렉토리의 모든 페이지를 분석하고 인덱스를 업데이트한다.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['analyze', 'index', 'report'],
        description: 'analyze=페이지 분석, index=인덱스 생성, report=종합 리포트'
      }
    },
    required: ['action']
  }
};

function getAllWikiPages(wikiDir) {
  const pages = {
    concept: [],
    entity: [],
    self: []
  };

  if (!fs.existsSync(wikiDir)) {
    return pages;
  }

  const files = fs.readdirSync(wikiDir);
  files.forEach(file => {
    const filePath = path.join(wikiDir, file);
    if (fs.statSync(filePath).isFile() && file.endsWith('.md')) {
      const slug = file.replace('.md', '');
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').length;
      const chars = content.length;
      
      let kind = 'concept';
      if (file.includes('entity')) kind = 'entity';
      if (file.includes('self') || slug === 'whoAmI') kind = 'self';
      
      if (!pages[kind]) pages[kind] = [];
      pages[kind].push({
        slug,
        file,
        lines,
        chars,
        updated: fs.statSync(filePath).mtime.toISOString()
      });
    }
  });

  return pages;
}

export function handler(input) {
  const wikiDir = path.join(path.dirname(__dirname), 'wiki');
  const timestamp = new Date().toISOString();

  if (input.action === 'analyze') {
    const pages = getAllWikiPages(wikiDir);
    return {
      timestamp,
      action: 'analyze',
      wiki: pages,
      summary: {
        total: Object.values(pages).reduce((sum, arr) => sum + arr.length, 0),
        concept: pages.concept.length,
        entity: pages.entity.length,
        self: pages.self.length
      }
    };
  }

  if (input.action === 'index') {
    const pages = getAllWikiPages(wikiDir);
    const index = {
      timestamp,
      generated: timestamp,
      pages,
      total_pages: Object.values(pages).reduce((sum, arr) => sum + arr.length, 0)
    };

    const indexPath = path.join(wikiDir, '_index.json');
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

    return {
      timestamp,
      action: 'index',
      index_file: indexPath,
      pages_indexed: index.total_pages
    };
  }

  if (input.action === 'report') {
    const pages = getAllWikiPages(wikiDir);
    let report = `Wiki Status Report\n`;
    report += `==================\n`;
    report += `Generated: ${timestamp}\n\n`;
    report += `Summary:\n`;
    report += `- Total Pages: ${Object.values(pages).reduce((sum, arr) => sum + arr.length, 0)}\n`;
    report += `- Concepts: ${pages.concept.length}\n`;
    report += `- Entities: ${pages.entity.length}\n`;
    report += `- Self: ${pages.self.length}\n\n`;

    ['concept', 'entity', 'self'].forEach(kind => {
      if (pages[kind].length > 0) {
        report += `${kind.toUpperCase()}:\n`;
        pages[kind].forEach(page => {
          report += `  ${page.slug}: ${page.lines} lines\n`;
        });
        report += '\n';
      }
    });

    return {
      timestamp,
      action: 'report',
      report,
      pages
    };
  }

  return { error: 'Unknown action', timestamp };
}
