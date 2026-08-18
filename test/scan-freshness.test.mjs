import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('scan：默认不联网并把有效缓存中的过期状态写入 catalog', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-scan-freshness-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const skillDir = path.join(home, '.codex', 'skills', 'cached-skill');
  const dataDir = path.join(home, '.skill-manager');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const skillText = '---\nname: cached-skill\nversion: 1.0.0\ndescription: cache test\n---\n';
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillText);
  const source = 'https://raw.githubusercontent.com/acme/cached-skill/main/SKILL.md';
  fs.writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify({
    version: 2,
    sources: { 'cached-skill': { source, version: '1.0.0' } },
    instances: {},
  }));
  const localHash = crypto.createHash('sha256').update(skillText).digest('hex').slice(0, 12);
  const check = { kind: 'skill-md', url: source, urls: [source], localVersion: '1.0.0', localHash };
  const key = crypto.createHash('sha256').update(JSON.stringify(check)).digest('hex').slice(0, 24);
  fs.writeFileSync(path.join(dataDir, 'update-cache.json'), JSON.stringify({
    version: 1,
    items: { [key]: { status: 'outdated', remoteVersion: '2.0.0', checkedAt: new Date().toISOString() } },
  }));

  const env = { ...process.env, HOME: home, USERPROFILE: home, KIMI_CODE_HOME: path.join(home, '.kimi-code') };
  const result = spawnSync(process.execPath, ['bin/skm.js', 'scan', '--json', '--lang', 'en'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.stdout);
  const skill = catalog.skills.find((item) => item.dirName === 'cached-skill' && item.tool === 'codex');
  assert.equal(skill.upstreamFreshness.status, 'outdated');
  assert.equal(skill.upstreamFreshness.remoteVersion, '2.0.0');
  assert.equal(skill.upstreamFreshness.cached, true);

  const lock = spawnSync(process.execPath, ['bin/skm.js', 'lock', '--json', '--lang', 'en'], { cwd: process.cwd(), encoding: 'utf8', env });
  assert.equal(lock.status, 0, lock.stderr);
  let refreshed = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
  assert.equal(refreshed.skills.find((item) => item.dirName === 'cached-skill').upstreamFreshness.status, 'outdated');

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `${skillText}\nlocal change\n`);
  const changedLock = spawnSync(process.execPath, ['bin/skm.js', 'lock', '--json', '--lang', 'en'], { cwd: process.cwd(), encoding: 'utf8', env });
  assert.equal(changedLock.status, 0, changedLock.stderr);
  refreshed = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
  assert.equal(refreshed.skills.find((item) => item.dirName === 'cached-skill').upstreamFreshness, null);
});

test('scan --online：无法完整判断时不误报全部最新', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-scan-incomplete-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const skillDir = path.join(home, '.codex', 'skills', 'untracked-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: untracked-skill\ndescription: no source\n---\n');
  const result = spawnSync(process.execPath, ['bin/skm.js', 'scan', '--online', '--lang', 'en'], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, KIMI_CODE_HOME: path.join(home, '.kimi-code') },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version check incomplete/);
  assert.doesNotMatch(result.stdout, /no skill updates were found/i);
});
