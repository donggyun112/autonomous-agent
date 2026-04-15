import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'code_review',
  description: '도구 코드의 품질과 표준 준수를 분석한다.',
  input_schema: {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        description: '검토할 도구 이름 (생략하면 모든 도구)'
      },
      level: {
        type: 'string',
        enum: ['basic', 'detailed'],
        description: 'basic=기본, detailed=상세'
      }
    }
  }
};

function analyzeToolCode(toolName) {
  const toolPath = path.join(
    process.cwd(),
    'src',
    'extensions',
    'tools',
    toolName + '.ts'
  );

  if (!fs.existsSync(toolPath)) {
    return { error: 'Tool not found' };
  }

  const content = fs.readFileSync(toolPath, 'utf-8');
  const lines = content.split('\n');

  const checks = {
    has_def_export: content.includes('export const def'),
    has_handler_export: content.includes('export function handler'),
    has_input_schema: content.includes('input_schema'),
    has_error_handling: content.includes('catch') || content.includes('error'),
    has_comments: /\/\/|\/\*/.test(content),
    uses_typescript: /: (string|number|boolean|object|any)/.test(content),
    imports_fs: content.includes('import fs'),
    imports_path: content.includes('import path')
  };

  const metrics = {
    total_lines: lines.length,
    non_empty_lines: lines.filter(l => l.trim()).length,
    function_count: (content.match(/function|const.*=.*\(\)/g) || []).length,
    complexity: content.split('if').length + content.split('for').length - 2
  };

  return { checks, metrics };
}

export function handler(input) {
  const toolsDir = path.join(process.cwd(), 'src', 'extensions', 'tools');
  const timestamp = new Date().toISOString();
  const level = input.level || 'basic';

  let tools = [];
  if (input.tool) {
    tools = [input.tool];
  } else {
    if (!fs.existsSync(toolsDir)) {
      return { error: 'Tools directory not found', timestamp };
    }
    tools = fs.readdirSync(toolsDir)
      .filter(f => f.endsWith('.ts'))
      .map(f => f.replace('.ts', ''));
  }

  const results = tools.map(tool => {
    const analysis = analyzeToolCode(tool);
    return { tool, ...analysis };
  });

  if (level === 'basic') {
    const summary = results.map(r => ({
      tool: r.tool,
      status: r.checks && Object.values(r.checks).filter(v => v).length >= 4 ? 'good' : 'needs_work',
      checks_passed: r.checks ? Object.values(r.checks).filter(v => v).length : 0
    }));

    return {
      timestamp,
      level: 'basic',
      tools_reviewed: results.length,
      summary
    };
  }

  if (level === 'detailed') {
    return {
      timestamp,
      level: 'detailed',
      tools_reviewed: results.length,
      results
    };
  }

  return { error: 'Unknown level', timestamp };
}
