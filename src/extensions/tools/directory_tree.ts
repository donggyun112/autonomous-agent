import type { Tool } from '../../core/tools.js';
import { readdir, stat } from 'fs/promises';
import { join, relative, resolve } from 'path';
import { DATA, ROOT, SRC } from '../../primitives/paths.js';

async function buildTree(dir: string, baseDir: string, depth: number = 0): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const indent = '  '.repeat(depth + 1);
    const relPath = relative(baseDir, join(dir, entry.name));
    if (entry.isDirectory()) {
      results.push(`${indent}[DIR] ${entry.name}/`);
      const subTree = await buildTree(join(dir, entry.name), baseDir, depth + 1);
      results.push(...subTree);
    } else {
      const fullPath = join(dir, entry.name);
      try {
        const s = await stat(fullPath);
        const size = s.size;
        results.push(`${indent}- ${entry.name} (${size} bytes)`);
      } catch {
        results.push(`${indent}- ${entry.name}`);
      }
    }
  }
  return results;
}

export const tool: Tool = {
  states: ['WAKE', 'REFLECT'],
  def: {
    name: 'directory_tree',
    description: 'Generate a tree view of a directory. Supports DATA, SRC, or custom paths. Limits depth to avoid flooding.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (defaults to project root). Must be within data/ or src/.' },
        depth: { type: 'number', description: 'Max depth (default 3).' },
        show_size: { type: 'boolean', description: 'Show file sizes (default true).' },
      },
      additionalProperties: false,
    },
  },
  handler: async (input) => {
    const requestedPath = typeof input.path === 'string' ? input.path.trim() : '';
    const depth = Number(input.depth ?? 3);
    const showSize = input.show_size !== false;

    let targetDir: string;
    if (requestedPath) {
      targetDir = resolve(ROOT, requestedPath);
    } else {
      targetDir = ROOT;
    }

    const lines = ['📁 ' + relative(ROOT, targetDir) + '/'];
    const tree = await buildTree(targetDir, targetDir, 0);
    lines.push(...tree);

    return lines.join('\n');
  },
};