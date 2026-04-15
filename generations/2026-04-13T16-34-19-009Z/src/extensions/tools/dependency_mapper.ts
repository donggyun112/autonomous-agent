import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'dependency_mapper',
  description: '도구들 간의 의존성을 분석하고 호출 그래프를 생성한다.',
  input_schema: {
    type: 'object',
    properties: {
      output: {
        type: 'string',
        enum: ['graph', 'matrix', 'report'],
        description: 'graph=그래프, matrix=의존성 행렬, report=리포트'
      }
    }
  }
};

function analyzeToolDependencies() {
  const toolsDir = path.join(path.dirname(__dirname), 'src', 'extensions', 'tools');
  const tools = {};
  const dependencies = {};

  if (!fs.existsSync(toolsDir)) {
    return { tools, dependencies };
  }

  const toolFiles = fs.readdirSync(toolsDir).filter(f => f.endsWith('.ts'));

  toolFiles.forEach(file => {
    const toolName = file.replace('.ts', '');
    const content = fs.readFileSync(path.join(toolsDir, file), 'utf-8');

    tools[toolName] = {
      name: toolName,
      file,
      lines: content.split('\n').length
    };

    // Find imports (simple pattern matching)
    const importMatches = content.match(/import .* from ['"].*['"];/g) || [];
    const localImports = importMatches.filter(m => 
      m.includes('..') && !m.includes('node_modules')
    );

    dependencies[toolName] = {
      imports: importMatches.length,
      local_imports: localImports.length
    };
  });

  return { tools, dependencies };
}

export function handler(input) {
  return (async () => {
  const { tools, dependencies } = analyzeToolDependencies();
  const timestamp = new Date().toISOString();
  const output = input.output || 'report';

  if (output === 'graph') {
    const nodes = Object.keys(tools).map(name => ({
      id: name,
      label: name,
      size: tools[name].lines
    }));

    const edges = [];
    Object.entries(dependencies).forEach(([tool, deps]) => {
      if (deps.local_imports > 0) {
        // Simplified: no actual edges tracked yet
      }
    });

    return {
      timestamp,
      output: 'graph',
      nodes,
      edges,
      total_tools: Object.keys(tools).length
    };
  }

  if (output === 'matrix') {
    const toolList = Object.keys(tools).sort();
    const matrix = {};

    toolList.forEach(tool => {
      matrix[tool] = {};
      toolList.forEach(other => {
        matrix[tool][other] = 0;
      });
    });

    return {
      timestamp,
      output: 'matrix',
      tools: toolList,
      matrix,
      size: toolList.length
    };
  }

  if (output === 'report') {
    let report = `Tool Dependency Report\n`;
    report += `======================\n`;
    report += `Total tools: ${Object.keys(tools).length}\n\n`;

    Object.entries(tools).forEach(([name, tool]) => {
      report += `${name}:\n`;
      report += `  Lines: ${tool.lines}\n`;
      report += `  Imports: ${dependencies[name].imports}\n`;
      report += `  Local imports: ${dependencies[name].local_imports}\n`;
    });

    return {
      timestamp,
      output: 'report',
      report,
      tools
    };
  }

  return { error: 'Unknown output format', timestamp };
  })();
}
