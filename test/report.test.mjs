import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportData, renderReportHtml } from '../src/commands/report.js';

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

test('report：汇总健康、风险、使用、会话和图谱数据', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [
      entry('dup-unused', 'claude-code', { descTokens: 220 }),
      entry('dup-unused', 'codex', { descTokens: 220 }),
      entry('used-skill', 'codex', { description: 'Convert markdown to html', category: '内容抓取与转换' }),
    ],
    mcpServers: [{ name: 'lark', tool: 'claude-code', transport: 'stdio', command: 'lark-mcp' }],
  };
  const merged = [
    {
      ...catalog.skills[0],
      tools: ['claude-code', 'codex'],
      entries: [catalog.skills[0], catalog.skills[1]],
      descTokens: 220,
    },
    { ...catalog.skills[2], tools: ['codex'], entries: [catalog.skills[2]] },
  ];
  const usage = {
    earliest: '2026-07-01T00:00:00Z',
    skills: { 'used-skill': { count: 3, lastUsed: '2026-07-19T00:00:00Z' } },
    mcp: {},
  };
  const sessions = [{ path: '/tmp/a.jsonl', tool: 'codex', workspace: '/tmp/a', size: 1200, mtimeMs: Date.now() - 10 * 86400e3 }];

  const data = buildReportData({ catalog, merged, usage, sessions, lang: 'en' });
  assert.equal(data.health.skills, 2);
  assert.equal(data.usage.topUsed[0].dirName, 'used-skill');
  assert.ok(data.risks.some((r) => r.title === 'Duplicate and never used'));
  assert.ok(data.graph.stats.skills >= 2);

  const html = renderReportHtml(data, 'en');
  assert.match(html, /skm Overview Report/);
  assert.match(html, /Recommendation Entry/);
  assert.match(html, /Knowledge Graph/);
  assert.match(html, /skm ask &quot;what you want to do&quot;/);
});
