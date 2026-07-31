import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportData, renderReportHtml } from '../src/commands/report.js';
import { anonymizeCatalog, anonymizeReportData } from '../src/anonymize.js';

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

test('report：支持脱敏与 MCP schema token 摘要', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    scanCwd: '/home/alice/private/project',
    skills: [
      entry('used-skill', 'codex', { description: 'Convert markdown to html' }),
    ],
    mcpServers: [{
      name: 'private-mcp',
      tool: 'codex',
      transport: 'stdio',
      command: '/home/alice/bin/private-mcp --token secret',
      configFile: '/home/alice/.codex/config.toml',
      schemaTokens: 160,
    }],
  };
  const usage = {
    earliest: '2026-07-01T00:00:00Z',
    skills: { 'used-skill': { count: 1, lastUsed: '2026-07-19T00:00:00Z' } },
    mcp: { 'private-mcp': { count: 2, lastUsed: '2026-07-19T00:00:00Z' } },
  };
  const sessions = [{ path: '/tmp/a.jsonl', tool: 'codex', workspace: '/home/alice/work/secret', size: 1200, mtimeMs: Date.now() }];
  const data = buildReportData({ catalog, usage, sessions, lang: 'en' });

  assert.equal(data.health.mcpSchemaTokens, 160);
  assert.equal(data.usage.topMcpContext[0].name, 'private-mcp');

  const safe = anonymizeReportData(data);
  assert.match(safe.sessions[0].workspace, /^workspace-[0-9a-f]{8}$/);
  assert.equal(safe.usage.topMcpContext[0].name, 'private-mcp');
  assert.doesNotMatch(JSON.stringify(safe), /\/home\/alice|--token secret/);

  const html = renderReportHtml(safe, 'en');
  assert.match(html, /MCP Schema Cost Top 10/);
  assert.doesNotMatch(html, /最密集套件/);
});

test('匿名导出：warning 字符串内嵌路径也会脱敏', () => {
  const safe = anonymizeCatalog({
    scannedAt: '2026-07-20T00:00:00Z',
    warnings: [
      '缺少或无法读取 SKILL.md：/home/alice/.cursor/skills/private-skill',
      'Cannot read C:\\Users\\alice\\.gemini\\skills\\private-skill\\SKILL.md',
    ],
  });
  const text = JSON.stringify(safe);
  assert.doesNotMatch(text, /\/home\/alice|C:\\Users\\alice|private-skill/);
  assert.match(text, /path-[0-9a-f]{8}/);
});

test('匿名导出：上游仓库与 git remote 地址会脱敏', () => {
  const safe = anonymizeCatalog({
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [{
      dirName: 'private-skill',
      upstream: {
        source: 'https://github.com/alice/private-skills/tree/main/private-skill',
        repository: 'https://github.com/alice/private-skills',
        homepage: 'https://example.com/private-skills',
        urls: [
          'https://github.com/alice/private-skills',
          'git@github.com:alice/private-skills.git',
        ],
        git: {
          root: '/home/alice/.codex/skills/private-skill',
          remote: 'git@github.com:alice/private-skills.git',
        },
      },
    }],
  });
  const text = JSON.stringify(safe);
  assert.doesNotMatch(text, /alice|private-skills|github\.com|example\.com|\/home\/alice/);
  assert.match(text, /url-[0-9a-f]{8}/);
  assert.match(text, /path-[0-9a-f]{8}/);
});
