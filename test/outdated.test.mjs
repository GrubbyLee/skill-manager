import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectOutdatedRows } from '../src/commands/outdated.js';
import { buildPackageManifest } from '../src/skillPackage.js';

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

test('outdated：扫描缓存模式只使用 24 小时内缓存，绝不请求网络', async () => {
  let called = false;
  const rows = await collectOutdatedRows([{
    dirName: 'cached-skill', tool: 'codex', scope: 'user',
    skillMdHash: 'local',
    upstream: { version: '1.0.0', source: 'https://github.com/acme/cached/tree/main' },
  }], {
    online: true,
    cacheOnly: true,
    fetchImpl: async () => { called = true; throw new Error('network must not be called'); },
    cache: { version: 1, items: {
      [cacheKeyForSkill()]: { status: 'outdated', remoteVersion: '2.0.0', checkedAt: new Date().toISOString() },
    } },
  });
  assert.equal(called, false);
  assert.equal(rows[0].status, 'outdated');
  assert.equal(rows[0].cached, true);
});

test('outdated：过期缓存不会伪装成最新状态', async () => {
  const rows = await collectOutdatedRows([{
    dirName: 'expired-skill', tool: 'codex', scope: 'user', skillMdHash: 'local',
    upstream: { version: '1.0.0', source: 'https://github.com/acme/expired/tree/main' },
  }], {
    online: true,
    cacheOnly: true,
    cache: { version: 1, items: {
      [crypto.createHash('sha256').update(JSON.stringify({
        kind: 'skill-md',
        url: 'https://raw.githubusercontent.com/acme/expired/main/SKILL.md',
        urls: ['https://raw.githubusercontent.com/acme/expired/main/SKILL.md'],
        localVersion: '1.0.0',
        localHash: 'local',
      })).digest('hex').slice(0, 24)]: {
        status: 'outdated', remoteVersion: '2.0.0', checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      },
    } },
  });
  assert.equal(rows[0].status, 'unchecked');
  assert.equal(rows[0].cached, undefined);
});

function cacheKeyForSkill() {
  const check = {
    kind: 'skill-md',
    url: 'https://raw.githubusercontent.com/acme/cached/main/SKILL.md',
    urls: ['https://raw.githubusercontent.com/acme/cached/main/SKILL.md'],
    localVersion: '1.0.0',
    localHash: 'local',
  };
  return crypto.createHash('sha256').update(JSON.stringify(check)).digest('hex').slice(0, 24);
}

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

test('outdated：区分本地领先与同版本内容分叉', async () => {
  const ahead = await collectOutdatedRows([{
    dirName: 'ahead-skill', tool: 'codex', scope: 'user', path: '/tmp/ahead-skill',
    skillMdHash: 'local-hash', upstream: { version: '2.0.0', source: 'https://example.com/SKILL.md' },
  }], {
    online: true,
    refresh: true,
    fetchImpl: async () => ({ ok: true, text: async () => '---\nname: ahead-skill\nversion: 1.9.0\n---\n' }),
    cache: { version: 1, items: {} },
  });
  assert.equal(ahead[0].status, 'ahead');

  const diverged = await collectOutdatedRows([{
    dirName: 'forked-skill', tool: 'codex', scope: 'user', path: '/tmp/forked-skill',
    skillMdHash: 'local-hash', upstream: { version: '1.0.0', source: 'https://example.com/SKILL.md' },
  }], {
    online: true,
    refresh: true,
    fetchImpl: async () => ({ ok: true, text: async () => '---\nname: forked-skill\nversion: 1.0.0\n---\nchanged' }),
    cache: { version: 1, items: {} },
  });
  assert.equal(diverged[0].status, 'diverged');
});

test('outdated：整包来源可识别仅资源文件发生的变更', async (t) => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-outdated-package-'));
  t.after(() => fs.rmSync(sourceDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceDir, 'references'));
  fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '---\nname: package-skill\nversion: 1.0.0\n---\n');
  fs.writeFileSync(path.join(sourceDir, 'references', 'guide.md'), 'upstream content\n');

  const currentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-outdated-current-'));
  t.after(() => fs.rmSync(currentDir, { recursive: true, force: true }));
  fs.cpSync(sourceDir, currentDir, { recursive: true });
  fs.writeFileSync(path.join(currentDir, 'references', 'guide.md'), 'local content\n');

  const rows = await collectOutdatedRows([{
    dirName: 'package-skill',
    tool: 'codex',
    scope: 'user',
    path: currentDir,
    packageHash: buildPackageManifest(currentDir).hash,
    skillMdHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(currentDir, 'SKILL.md'))).digest('hex').slice(0, 12),
    upstream: {
      version: '1.0.0',
      source: pathToFileURL(sourceDir).href,
      packageHash: 'stale-source-record',
    },
  }], { online: true, refresh: true, cache: { version: 1, items: {} } });

  assert.equal(rows[0].status, 'diverged');
  assert.equal(rows[0].remotePackageHash, buildPackageManifest(sourceDir).hash);
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

  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.tool === 'claude-code').status, 'untracked');
  assert.equal(rows.find((row) => row.tool === 'codex').status, 'latest');
  assert.equal(rows.find((row) => row.tool === 'codex').remoteHash, remoteHash);
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
