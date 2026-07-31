import test from 'node:test';
import assert from 'node:assert/strict';
import { applySourceToSkill, applySourcesToSkills, isValidSourceUrl, missingSourceRows } from '../src/sources.js';
import { collectOutdatedRows } from '../src/commands/outdated.js';

const sources = {
  version: 1,
  sources: {
    'local-skill': {
      source: 'https://github.com/example/skills/tree/main/local-skill',
      version: '1.0.0',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  },
};

test('sources：本地补充来源会合并到 skill upstream，且不覆盖已有 frontmatter', () => {
  const skill = applySourceToSkill({
    dirName: 'local-skill',
    name: 'local-skill',
    skillMdHash: 'abc',
    upstream: { version: '0.9.0' },
  }, sources);

  assert.equal(skill.upstream.version, '0.9.0');
  assert.equal(skill.upstream.source, 'https://github.com/example/skills/tree/main/local-skill');
  assert.equal(skill.upstream.localSource, true);
  assert.equal(skill.upstream.localSourceKey, 'local-skill');
  assert.equal(skill.upstream.trackable, true);
});

test('sources：missing 只列出缺少上游 URL 的 skill', () => {
  const rows = missingSourceRows([
    {
      dirName: 'local-skill',
      name: 'local-skill',
      tools: ['codex'],
      upstream: { version: '1.0.0' },
    },
    {
      dirName: 'version-only',
      name: 'version-only',
      tools: ['codex'],
      upstream: { version: '1.0.0' },
    },
    {
      dirName: 'missing-all',
      name: 'missing-all',
      tools: ['codex'],
      upstream: {},
    },
  ], sources);

  assert.deepEqual(rows.map((row) => row.dirName), ['version-only', 'missing-all']);
  assert.equal(rows[0].status, 'version-only');
  assert.equal(rows[1].status, 'missing');
});

test('sources：本地来源可让 outdated 从无法判断变为可联网检查', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => '---\nname: local-skill\nversion: 1.1.0\n---\n',
  });
  const skills = applySourcesToSkills([
    {
      dirName: 'local-skill',
      name: 'local-skill',
      category: '研发辅助',
      tools: ['codex'],
      upstream: { version: '1.0.0' },
    },
  ], sources);

  const rows = await collectOutdatedRows(skills, {
    online: true,
    refresh: true,
    lang: 'zh-CN',
    fetchImpl,
    cache: { version: 1, items: {} },
  });

  assert.equal(rows[0].status, 'outdated');
  assert.equal(rows[0].remoteVersion, '1.1.0');
});

test('sources：URL 校验支持常见 GitHub/Gitee 与 SSH remote', () => {
  assert.equal(isValidSourceUrl('https://github.com/org/repo/tree/main/skill'), true);
  assert.equal(isValidSourceUrl('git@github.com:org/repo.git'), true);
  assert.equal(isValidSourceUrl('ssh://git@example.com/org/repo.git'), true);
  assert.equal(isValidSourceUrl('file:///tmp/skill'), false);
  assert.equal(isValidSourceUrl('not-a-url'), false);
});
