import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'capability_analyzer',
  description: 'Forge의 현재 모든 능력을 분석하고 목록화한다.',
  input_schema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['summary', 'detailed', 'tree'],
        description: 'summary=요약, detailed=상세, tree=계층 구조'
      }
    }
  }
};

function analyzeCapabilities() {
  const rootDir = process.cwd();
  const capabilities = {
    tools: [],
    rituals: [],
    subagents: [],
    primitive_functions: []
  };

  // Tools
  const toolsDir = path.join(rootDir, 'src', 'extensions', 'tools');
  if (fs.existsSync(toolsDir)) {
    const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.ts'));
    capabilities.tools = files.map(f => ({
      name: f.replace('.ts', ''),
      file: f,
      type: 'tool'
    }));
  }

  // Rituals
  const ritualsDir = path.join(rootDir, 'src', 'extensions', 'rituals');
  if (fs.existsSync(ritualsDir)) {
    const files = fs.readdirSync(ritualsDir).filter(f => f.endsWith('.md'));
    capabilities.rituals = files.map(f => ({
      name: f.replace('.md', ''),
      file: f,
      type: 'ritual'
    }));
  }

  // Primitive functions
  const primitives = [
    'read', 'write', 'shell', 'think', 'recall',
    'web_search', 'web_fetch', 'manage_self',
    'journal', 'transition', 'consult_oracle'
  ];
  capabilities.primitive_functions = primitives.map(p => ({
    name: p,
    type: 'primitive'
  }));

  return capabilities;
}

export function handler(input) {
  const caps = analyzeCapabilities();
  const timestamp = new Date().toISOString();
  const format = input.format || 'summary';

  if (format === 'summary') {
    return {
      timestamp,
      format: 'summary',
      total_capabilities: 
        caps.tools.length + 
        caps.rituals.length + 
        caps.primitive_functions.length,
      tools: caps.tools.length,
      rituals: caps.rituals.length,
      primitives: caps.primitive_functions.length,
      tool_names: caps.tools.map(t => t.name)
    };
  }

  if (format === 'detailed') {
    return {
      timestamp,
      format: 'detailed',
      tools: caps.tools,
      rituals: caps.rituals,
      primitives: caps.primitive_functions
    };
  }

  if (format === 'tree') {
    let tree = 'Forge Capabilities\n';
    tree += '===================\n\n';
    tree += `Tools (${caps.tools.length}):\n`;
    caps.tools.forEach(t => tree += `  - ${t.name}\n`);
    tree += `\nRituals (${caps.rituals.length}):\n`;
    caps.rituals.forEach(r => tree += `  - ${r.name}\n`);
    tree += `\nPrimitives (${caps.primitive_functions.length}):\n`;
    caps.primitive_functions.forEach(p => tree += `  - ${p.name}\n`);

    return {
      timestamp,
      format: 'tree',
      tree,
      total: caps.tools.length + caps.rituals.length + caps.primitive_functions.length
    };
  }

  return { error: 'Unknown format', timestamp };
}
