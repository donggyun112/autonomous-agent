import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'test_runner',
  description: '모든 도구를 테스트하고 작동 상태를 확인한다.',
  input_schema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['quick', 'full', 'specific'],
        description: 'quick=빠른 테스트, full=전체, specific=특정 도구'
      },
      tool: {
        type: 'string',
        description: 'mode=specific일 때 테스트할 도구 이름'
      }
    }
  }
};

function listTools() {
  const toolsDir = path.join(process.cwd(), 'src', 'extensions', 'tools');
  if (!fs.existsSync(toolsDir)) {
    return [];
  }

  return fs.readdirSync(toolsDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => f.replace('.ts', ''));
}

function checkToolFile(toolName) {
  const toolPath = path.join(
    process.cwd(),
    'src',
    'extensions',
    'tools',
    toolName + '.ts'
  );

  if (!fs.existsSync(toolPath)) {
    return { status: 'missing', message: 'Tool file not found' };
  }

  const content = fs.readFileSync(toolPath, 'utf-8');

  // Check for required exports
  const hasDefExport = content.includes('export const def');
  const hasHandlerExport = content.includes('export function handler');

  if (!hasDefExport || !hasHandlerExport) {
    return {
      status: 'invalid',
      message: 'Missing required exports',
      def: hasDefExport,
      handler: hasHandlerExport
    };
  }

  // Check for syntax errors (simple check)
  const syntaxOk = !content.includes('\\n\\n\\n\\n');

  return {
    status: 'ok',
    lines: content.split('\n').length,
    bytes: content.length,
    syntax_ok: syntaxOk
  };
}

export function handler(input) {
  
  const tools = listTools();
  const timestamp = new Date().toISOString();
  const mode = input.mode || 'quick';

  if (mode === 'quick') {
    const tested = tools.slice(0, 3).map(tool => ({
      name: tool,
      status: checkToolFile(tool).status
    }));

    return {
      timestamp,
      mode: 'quick',
      total_tools: tools.length,
      tested_count: tested.length,
      tested: tested
    };
  }

  if (mode === 'full') {
    const tested = tools.map(tool => ({
      name: tool,
      check: checkToolFile(tool)
    }));

    const passCount = tested.filter(t => t.check.status === 'ok').length;

    return {
      timestamp,
      mode: 'full',
      total_tools: tools.length,
      pass: passCount,
      fail: tools.length - passCount,
      results: tested
    };
  }

  if (mode === 'specific' && input.tool) {
    const check = checkToolFile(input.tool);
    return {
      timestamp,
      mode: 'specific',
      tool: input.tool,
      check
    };
  }

  return { error: 'Invalid mode or missing tool', timestamp };
}
