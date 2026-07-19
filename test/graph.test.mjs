import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeGraph, renderGraph } from '../src/commands/graph.js';

const skill = (dirName, description, extra = {}) => ({
  id: `codex:user:${dirName}`,
  tool: extra.tool || 'codex',
  scope: 'user',
  dirName,
  name: dirName,
  description,
  category: extra.category || '内容抓取与转换',
  path: `/tmp/${dirName}`,
  realPath: `/tmp/${dirName}`,
  skillMdHash: extra.hash || dirName,
  descTokens: 10,
});

test('知识图谱：构建 skill/MCP 节点与核心关系', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [
      skill('baoyu-url-to-markdown', 'Fetch any URL and convert to markdown.'),
      skill('baoyu-markdown-to-html', 'Converts Markdown to styled HTML.'),
      skill('baoyu-html-to-markdown', 'Convert HTML pages to markdown.'),
      skill('lark-doc', '飞书文档协作。Uses lark MCP.', { category: '办公协作（飞书）' }),
      skill('lark-sheets', '飞书电子表格。', { category: '办公协作（飞书）' }),
    ],
    mcpServers: [
      { name: 'lark', tool: 'claude-code', transport: 'stdio', command: 'lark-mcp' },
    ],
  };
  const graph = buildKnowledgeGraph(catalog, {
    skills: { 'baoyu-url-to-markdown': { count: 2, lastUsed: '2026-07-19T00:00:00Z' } },
    mcp: { lark: { count: 1, lastUsed: '2026-07-19T00:00:00Z' } },
  });

  assert.ok(graph.nodes.some((n) => n.id === 'skill:baoyu-url-to-markdown' && n.usageCount === 2));
  assert.ok(graph.nodes.some((n) => n.id === 'mcp:lark'));
  assert.ok(graph.nodes.some((n) => n.id === 'family:baoyu'));
  assert.ok(graph.nodes.some((n) => n.id === 'category:内容抓取与转换'));
  assert.ok(graph.nodes.some((n) => n.id === 'platform:Lark / 飞书'));

  assert.ok(graph.edges.some((e) => e.type === 'same_family' && e.target === 'family:baoyu'));
  assert.ok(graph.edges.some((e) => e.type === 'same_category' && e.target === 'category:内容抓取与转换'));
  assert.ok(graph.edges.some((e) => e.type === 'pipeline' && e.source === 'skill:baoyu-url-to-markdown' && e.target === 'skill:baoyu-markdown-to-html'));
  assert.ok(graph.edges.some((e) => e.type === 'reverse_transform'));
  assert.ok(graph.edges.some((e) => e.type === 'shared_platform' && e.target === 'platform:Lark / 飞书'));
  assert.ok(graph.edges.some((e) => e.type === 'uses_mcp' && e.target === 'mcp:lark'));
});

test('知识图谱：异名同内容生成重复关系', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [
      skill('foo-a', 'same', { hash: 'same-hash' }),
      skill('bar-b', 'same', { hash: 'same-hash' }),
    ],
    mcpServers: [],
  };
  const graph = buildKnowledgeGraph(catalog);
  assert.ok(graph.edges.some((e) => e.type === 'duplicate' && e.confidence === 'explicit'));
});

test('知识图谱 HTML：关系过滤同时作用于边和节点', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [
      skill('baoyu-url-to-markdown', 'Fetch any URL and convert to markdown.'),
      skill('baoyu-markdown-to-html', 'Converts Markdown to styled HTML.'),
    ],
    mcpServers: [],
  };
  const graph = buildKnowledgeGraph(catalog);
  const html = renderGraph(graph, 'html');

  assert.match(html, /data-source="skill:baoyu-url-to-markdown"/);
  assert.match(html, /data-target="skill:baoyu-markdown-to-html"/);
  assert.match(html, /data-id="skill:baoyu-url-to-markdown"/);
  assert.match(html, /function applyFilters\(\)/);
  assert.match(html, /relationNodeIds/);
  assert.match(html, /当前显示：/);
});

test('知识图谱 HTML：关系说明与节点拖拽保持单文件实现', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [
      skill('baoyu-url-to-markdown', 'Fetch any URL and convert to markdown.'),
      skill('baoyu-markdown-to-html', 'Converts Markdown to styled HTML.'),
    ],
    mcpServers: [],
  };
  const graph = buildKnowledgeGraph(catalog);
  const html = renderGraph(graph, 'html');

  assert.match(html, /class="edge-help"/);
  assert.match(html, /同源：目录名前缀相同/);
  assert.match(html, /反向转换：两个 skill 的转换方向相反/);
  assert.match(html, /data-x="/);
  assert.match(html, /function setNodePosition/);
  assert.match(html, /function updateConnectedEdges/);
  assert.match(html, /pointermove/);
});
