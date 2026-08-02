import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildOverview, renderOverview } from '../src/overview.js';

test('overview：按治理域汇总并保留 status JSON 兼容字段', () => {
  const catalog = {
    scannedAt: '2026-07-20T00:00:00Z',
    skills: [
      skill({ dirName: 'alpha', tool: 'claude-code', path: '/a/alpha', realPath: '/a/alpha', source: 'https://github.com/acme/alpha/tree/main/alpha' }),
      skill({ dirName: 'alpha', tool: 'codex', path: '/b/alpha', realPath: '/b/alpha', source: 'https://github.com/acme/alpha/tree/main/alpha' }),
      skill({ dirName: 'beta', tool: 'codex', path: '/b/beta', realPath: '/b/beta', version: '1.0.0' }),
    ],
    mcpServers: [
      { name: 'filesystem', tool: 'claude-code' },
      { name: 'search', tool: 'codex' },
    ],
    security: { summary: { high: 1, medium: 0, low: 0, info: 0 } },
    warnings: ['bad frontmatter'],
  };
  const usage = {
    skills: { beta: { count: 2, lastUsed: '2026-07-21T00:00:00Z' } },
    mcp: {},
    earliest: '2026-07-01T00:00:00Z',
  };
  const sessions = [{ path: '/s/1.jsonl', workspace: '/repo', size: 1024, mtimeMs: 1 }];

  const overview = buildOverview({ catalog, usage, sessions, lang: 'en' });

  assert.equal(overview.skills, 2);
  assert.equal(overview.mcpServers, 2);
  assert.equal(overview.zombies, 1);
  assert.equal(overview.zombieRate, 0.5);
  assert.equal(overview.dupEntities, 1);
  assert.deepEqual(overview.primaryCleanTargets, ['alpha']);
  assert.equal(overview.domains.inventory.sameNameBoth, 1);
  assert.equal(overview.domains.risks.securitySummary.high, 1);
  assert.equal(overview.domains.versions.sourceMissing, 1);
  assert.equal(overview.domains.recommendation.commands[0].startsWith('skm ask'), true);
});

test('overview：版本治理使用互斥状态统计', () => {
  const overview = buildOverview({
    catalog: {
      scannedAt: '2026-07-20T00:00:00Z',
      skills: [
        skill({ dirName: 'checkable-url', tool: 'codex', path: '/s/checkable-url', realPath: '/s/checkable-url', source: 'https://github.com/acme/skills/tree/main/checkable-url' }),
        skill({ dirName: 'unsupported-source', tool: 'codex', path: '/s/unsupported-source', realPath: '/s/unsupported-source', source: 'git@github.com:acme/skills.git' }),
        skill({ dirName: 'version-only', tool: 'codex', path: '/s/version-only', realPath: '/s/version-only', version: '1.0.0' }),
        skill({ dirName: 'untracked', tool: 'codex', path: '/s/untracked', realPath: '/s/untracked' }),
      ],
      mcpServers: [],
      security: { summary: { high: 0, medium: 0, low: 0, info: 0 } },
      warnings: [],
    },
    usage: { skills: {}, mcp: {}, earliest: null },
    sessions: [],
    lang: 'en',
  });

  assert.deepEqual({
    unchecked: overview.domains.versions.unchecked,
    unknown: overview.domains.versions.unknown,
    untracked: overview.domains.versions.untracked,
  }, { unchecked: 1, unknown: 2, untracked: 1 });
});

test('overview：英文渲染不泄露未翻译 key', () => {
  const overview = buildOverview({
    catalog: {
      scannedAt: '2026-07-20T00:00:00Z',
      skills: [skill({ dirName: 'alpha', tool: 'claude-code', path: '/a/alpha', realPath: '/a/alpha' })],
      mcpServers: [],
      security: { summary: { high: 0, medium: 0, low: 0, info: 0 } },
      warnings: [],
    },
    usage: { skills: {}, mcp: {}, earliest: null },
    sessions: [],
    lang: 'en',
  });

  const text = renderOverview(overview, 'en');

  assert.match(text, /skm Governance Overview/);
  assert.match(text, /Inventory scan/);
  assert.doesNotMatch(text, /overview\./);
});

test('CLI：兜底静默扫描不追加治理总览到 stderr', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-overview-home-'));
  const result = spawnSync(process.execPath, ['bin/skm.js', 'list', '--json', '--lang', 'en'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.match(result.stderr, /No valid catalog found/);
  assert.doesNotMatch(result.stderr, /Governance Overview/);
});

function skill({ dirName, tool, path, realPath, source, version }) {
  return {
    dirName,
    name: dirName,
    tool,
    scope: 'user',
    path,
    realPath,
    category: '研发辅助',
    description: `${dirName} skill`,
    descTokens: 10,
    upstream: { source, version },
    securityFindings: [],
  };
}
