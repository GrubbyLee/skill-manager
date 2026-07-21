import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRisks } from '../src/commands/risks.js';

const entry = (dirName, tool, extra = {}) => ({
  id: `${tool}:user:${dirName}`,
  tool,
  scope: 'user',
  dirName,
  name: dirName,
  description: extra.description ?? 'A useful skill',
  category: extra.category || '研发辅助',
  path: `/tmp/${tool}/${dirName}`,
  realPath: extra.realPath || `/tmp/${tool}/${dirName}`,
  skillMdHash: extra.hash || `${dirName}-${tool}`,
  descTokens: extra.descTokens ?? 20,
});

test('risks：识别双份未使用、高上下文开销、闲置 MCP 与日志体积', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [
      entry('dup-unused', 'claude-code', { descTokens: 220 }),
      entry('dup-unused', 'codex', { descTokens: 220 }),
      entry('used-old', 'codex', { descTokens: 30 }),
      entry('missing-desc', 'codex', { description: '' }),
    ],
    mcpServers: [
      { name: 'lark', tool: 'claude-code', transport: 'stdio' },
      { name: 'drawio', tool: 'codex', transport: 'stdio' },
    ],
  };
  const merged = [
    {
      ...catalog.skills[0],
      tools: ['claude-code', 'codex'],
      entries: [catalog.skills[0], catalog.skills[1]],
      descTokens: 220,
    },
    { ...catalog.skills[2], tools: ['codex'], entries: [catalog.skills[2]] },
    { ...catalog.skills[3], tools: ['codex'], entries: [catalog.skills[3]] },
  ];
  const usage = {
    skills: { 'used-old': { count: 2, lastUsed: '2026-01-01T00:00:00Z' } },
    mcp: {},
  };
  const sessions = [
    { path: '/tmp/a.jsonl', tool: 'codex', workspace: '/tmp/a', size: 800e6, mtimeMs: Date.now() - 120 * 86400e3 },
    { path: '/tmp/b.jsonl', tool: 'codex', workspace: '/tmp/a', size: 500e6, mtimeMs: Date.now() - 110 * 86400e3 },
  ];

  const report = collectRisks({ catalog, merged, usage, sessions });
  assert.equal(report.items.find((i) => i.title === '双份且从未使用').severity, 'high');
  assert.equal(report.items.find((i) => i.title === '高上下文开销且未使用').count, 1);
  assert.equal(report.items.find((i) => i.title === 'Claude 侧闲置 MCP').count, 1);
  assert.equal(report.items.find((i) => i.title === '仅 Codex 侧 MCP').severity, 'info');
  assert.equal(report.items.find((i) => i.title === '会话日志体积').severity, 'medium');
  assert.ok(report.score < 100);
});

test('risks：英文模式只本地化展示字段，默认中文结构保持兼容', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [
      entry('dup-unused', 'claude-code', { descTokens: 220 }),
      entry('dup-unused', 'codex', { descTokens: 220 }),
    ],
    mcpServers: [],
  };
  const merged = [{
    ...catalog.skills[0],
    tools: ['claude-code', 'codex'],
    entries: [catalog.skills[0], catalog.skills[1]],
    descTokens: 220,
  }];
  const usage = { skills: {}, mcp: {} };

  const zh = collectRisks({ catalog, merged, usage, sessions: [] });
  const en = collectRisks({ catalog, merged, usage, sessions: [], lang: 'en' });

  assert.equal(zh.items[0].title, '双份且从未使用');
  assert.equal(en.items[0].title, 'Duplicate and never used');
  assert.match(en.items[0].samples[0], /about 220 tokens/);
});
