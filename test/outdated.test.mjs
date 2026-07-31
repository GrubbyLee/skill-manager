import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { collectOutdatedRows } from '../src/commands/outdated.js';

test('outdated：离线模式只读取本地上游线索，不联网判断', async () => {
  const rows = await collectOutdatedRows([
    {
      dirName: 'skill-navigator',
      name: 'skill-navigator',
      category: 'Skill 开发与管理',
      tools: ['codex'],
      skillMdHash: 'abc123',
      upstream: {
        version: '0.1.4',
        source: 'https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator',
      },
    },
    {
      dirName: 'local-only',
      name: 'local-only',
      category: '研发辅助',
      tools: ['codex'],
      skillMdHash: 'def456',
      upstream: {},
    },
  ], { online: false, lang: 'zh-CN' });

  assert.equal(rows[0].dirName, 'skill-navigator');
  assert.equal(rows[0].status, 'unchecked');
  assert.equal(rows[0].currentVersion, '0.1.4');
  assert.equal(rows[1].status, 'untracked');
});

test('outdated：联网模式可通过远端 SKILL.md version 判断落后', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => '---\nname: skill-navigator\nversion: 0.1.5\ndescription: 测试\n---\n',
  });

  const rows = await collectOutdatedRows([
    {
      dirName: 'skill-navigator',
      name: 'skill-navigator',
      category: 'Skill 开发与管理',
      tools: ['codex'],
      skillMdHash: 'abc123',
      upstream: {
        version: '0.1.4',
        source: 'https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator',
      },
    },
  ], { online: true, refresh: true, lang: 'zh-CN', fetchImpl, cache: { version: 1, items: {} } });

  assert.equal(rows[0].status, 'outdated');
  assert.equal(rows[0].remoteVersion, '0.1.5');
});

test('outdated：联网模式可通过 git remote HEAD 判断最新', async () => {
  const head = '0123456789abcdef0123456789abcdef01234567';
  const spawnImpl = () => ({
    status: 0,
    stdout: `${head}\trefs/heads/main\n`,
  });

  const rows = await collectOutdatedRows([
    {
      dirName: 'git-skill',
      name: 'git-skill',
      category: '研发辅助',
      tools: ['codex'],
      upstream: {
        git: {
          remote: 'https://github.com/example/skills.git',
          branch: 'main',
          head,
        },
      },
    },
  ], { online: true, refresh: true, lang: 'en', spawnImpl, cache: { version: 1, items: {} } });

  assert.equal(rows[0].status, 'latest');
  assert.equal(rows[0].remoteCommit, head);
});

test('outdated：git 检查保留 SSH remote，不改写为 HTTPS', async () => {
  const head = 'abcdef0123456789abcdef0123456789abcdef01';
  let remoteArg = '';
  const spawnImpl = (_cmd, args) => {
    remoteArg = args[1];
    return {
      status: 0,
      stdout: `${head}\trefs/heads/main\n`,
    };
  };

  const rows = await collectOutdatedRows([
    {
      dirName: 'private-skill',
      name: 'private-skill',
      category: '研发辅助',
      tools: ['codex'],
      upstream: {
        git: {
          remote: 'git@github.com:example/private-skills.git',
          branch: 'main',
          head,
        },
      },
    },
  ], { online: true, refresh: true, lang: 'zh-CN', spawnImpl, cache: { version: 1, items: {} } });

  assert.equal(remoteArg, 'git@github.com:example/private-skills.git');
  assert.equal(rows[0].status, 'latest');
});

test('outdated：同名多端合并后使用带上游信息的 entry hash', async () => {
  const remoteText = '---\nname: shared-skill\ndescription: 测试\n---\n正文';
  const remoteHash = crypto.createHash('sha256').update(remoteText).digest('hex').slice(0, 12);
  const fetchImpl = async () => ({
    ok: true,
    text: async () => remoteText,
  });

  const rows = await collectOutdatedRows([
    {
      dirName: 'shared-skill',
      name: 'shared-skill',
      category: '研发辅助',
      tools: ['claude-code', 'codex'],
      skillMdHash: 'wrong-local-hash',
      entries: [
        {
          tool: 'claude-code',
          dirName: 'shared-skill',
          skillMdHash: 'wrong-local-hash',
          upstream: {},
        },
        {
          tool: 'codex',
          dirName: 'shared-skill',
          skillMdHash: remoteHash,
          upstream: {
            source: 'https://github.com/example/skills/tree/main/shared-skill',
          },
        },
      ],
    },
  ], { online: true, refresh: true, lang: 'zh-CN', fetchImpl, cache: { version: 1, items: {} } });

  assert.equal(rows[0].status, 'latest');
  assert.equal(rows[0].remoteHash, remoteHash);
});

test('outdated：裸 GitHub 仓库 URL 会保守探测根目录 main/master SKILL.md', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return {
      ok: seen.length === 2,
      status: 404,
      text: async () => '---\nname: root-skill\nversion: 1.0.0\n---\n',
    };
  };

  const rows = await collectOutdatedRows([
    {
      dirName: 'root-skill',
      name: 'root-skill',
      category: '研发辅助',
      tools: ['codex'],
      upstream: {
        version: '1.0.0',
        repository: 'https://github.com/example/root-skill',
      },
    },
  ], { online: true, refresh: true, lang: 'en', fetchImpl, cache: { version: 1, items: {} } });

  assert.deepEqual(seen, [
    'https://raw.githubusercontent.com/example/root-skill/main/SKILL.md',
    'https://raw.githubusercontent.com/example/root-skill/master/SKILL.md',
  ]);
  assert.equal(rows[0].status, 'latest');
});

test('outdated：优先使用 git upstream ref，而不是只看本地分支名', async () => {
  const head = '1111111111111111111111111111111111111111';
  let refArg = '';
  const spawnImpl = (_cmd, args) => {
    refArg = args[2];
    return {
      status: 0,
      stdout: `${head}\trefs/heads/main\n`,
    };
  };

  const rows = await collectOutdatedRows([
    {
      dirName: 'git-skill',
      name: 'git-skill',
      category: '研发辅助',
      tools: ['codex'],
      upstream: {
        git: {
          remote: 'https://github.com/example/skills.git',
          branch: 'feature/local',
          upstreamRef: 'origin/main',
          head,
        },
      },
    },
  ], { online: true, refresh: true, lang: 'en', spawnImpl, cache: { version: 1, items: {} } });

  assert.equal(refArg, 'refs/heads/main');
  assert.equal(rows[0].status, 'latest');
});
