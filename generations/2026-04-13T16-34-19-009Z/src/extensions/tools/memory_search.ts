import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const def = {
  name: 'memory_search',
  description: 'memory.json을 검색하고 개념별 정보를 추출한다.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '검색 쿼리 (선택)'
      },
      action: {
        type: 'string',
        enum: ['search', 'stats', 'graph'],
        description: 'search=검색, stats=통계, graph=그래프 분석'
      }
    },
    required: ['action']
  }
};

function loadMemory() {
  const memoryPath = path.join(path.dirname(__dirname), 'memory.json');
  try {
    return JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
  } catch {
    return { nodes: [], edges: [] };
  }
}

export function handler(input) {
  return (async () => {
  const memory = loadMemory();
  const timestamp = new Date().toISOString();

  if (input.action === 'search') {
    const query = (input.query || '').toLowerCase();
    const results = {
      timestamp,
      query,
      nodes: memory.nodes ? memory.nodes.filter(n => 
        (n.id && n.id.toLowerCase().includes(query)) ||
        (n.label && n.label.toLowerCase().includes(query))
      ) : [],
      edges: memory.edges ? memory.edges.filter(e =>
        (e.source && e.source.toLowerCase().includes(query)) ||
        (e.target && e.target.toLowerCase().includes(query))
      ) : []
    };
    results.count = results.nodes.length + results.edges.length;
    return results;
  }

  if (input.action === 'stats') {
    const stats = {
      timestamp,
      total_nodes: memory.nodes ? memory.nodes.length : 0,
      total_edges: memory.edges ? memory.edges.length : 0,
      node_types: {},
      edge_types: {}
    };

    if (memory.nodes) {
      memory.nodes.forEach(n => {
        const type = n.type || 'unknown';
        stats.node_types[type] = (stats.node_types[type] || 0) + 1;
      });
    }

    if (memory.edges) {
      memory.edges.forEach(e => {
        const type = e.type || 'unknown';
        stats.edge_types[type] = (stats.edge_types[type] || 0) + 1;
      });
    }

    return stats;
  }

  if (input.action === 'graph') {
    const nodes = memory.nodes || [];
    const edges = memory.edges || [];
    
    // 간단한 그래프 분석: 중심도(centrality) 계산
    const centrality = {};
    nodes.forEach(n => {
      const id = n.id;
      const outgoing = edges.filter(e => e.source === id).length;
      const incoming = edges.filter(e => e.target === id).length;
      centrality[id] = outgoing + incoming;
    });

    const topNodes = Object.entries(centrality)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, score]) => ({ id, centrality: score }));

    return {
      timestamp,
      total_nodes: nodes.length,
      total_edges: edges.length,
      top_nodes: topNodes
    };
  }

  return { error: 'Unknown action', timestamp };
  })();
}
