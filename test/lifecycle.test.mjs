import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

test('生命周期：本地目录安装会记录来源，并支持更新、回滚、历史闭环', async () => {
  const home = makeHome();
  let remoteText = skillMd('alpha', 'v1 description', '1.0.0');
  const server = await startSkillServer(() => remoteText);
  try {
    const source = makeSkillSource('alpha', 'v1 description', '1.0.0', { source: server.url });

    const install = await runAsync(['install', source, '--tool', 'claude', '--yes', '--lang', 'en'], home);
    assert.equal(install.status, 0, install.stderr);
    const target = path.join(home, '.claude', 'skills', 'alpha');
    assert.equal(fs.existsSync(path.join(target, 'SKILL.md')), true);
    const sources = JSON.parse(fs.readFileSync(path.join(home, '.skill-manager', 'sources.json'), 'utf8'));
    assert.equal(sources.sources.alpha.source, server.url);

    remoteText = skillMd('alpha', 'v2 description', '2.0.0');
    const dryUpdate = await runAsync(['update', 'alpha', '--tool', 'claude', '--dry-run', '--lang', 'en'], home);
    assert.equal(dryUpdate.status, 0, dryUpdate.stderr);
    const update = await runAsync(['update', 'alpha', '--tool', 'claude', '--yes', '--lang', 'en'], home);
    assert.equal(update.status, 0, update.stderr);
    assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /v2 description/);

    const rollback = await runAsync(['rollback', 'alpha', '--tool', 'claude', '--yes', '--lang', 'en'], home);
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /v1 description/);

    const history = await runAsync(['history', 'alpha', '--json', '--lang', 'en'], home);
    assert.equal(history.status, 0, history.stderr);
    const events = JSON.parse(history.stdout).events;
    assert.equal(events.some((event) => event.type === 'install'), true);
    assert.equal(events.some((event) => event.type === 'rollback'), true);
  } finally {
    await closeServer(server.server);
  }
});

test('生命周期：lock、policy、profile、eval 支持 JSON/只读路径', () => {
  const home = makeHome();
  const source = makeSkillSource('beta', 'beta description', '1.0.0');
  assert.equal(run(['install', source, '--tool', 'claude', '--yes', '--lang', 'en'], home).status, 0);
  assert.equal(run(['scan', '--json', '--lang', 'en'], home).status, 0);

  const lock = run(['lock', '--json', '--lang', 'en'], home);
  assert.equal(lock.status, 0, lock.stderr);
  assert.equal(JSON.parse(lock.stdout).items.some((item) => item.name === 'beta'), true);
  assert.equal(fs.existsSync(path.join(home, '.skill-manager', 'skill-lock.json')), false);
  const lockWrite = run(['lock', '--lang', 'en'], home);
  assert.equal(lockWrite.status, 0, lockWrite.stderr);
  assert.equal(fs.existsSync(path.join(home, '.skill-manager', 'skill-lock.json')), true);

  const policyInit = run(['policy', 'init', '--yes', '--lang', 'en'], home);
  assert.equal(policyInit.status, 0, policyInit.stderr);
  const policy = run(['policy', 'check', '--json', '--lang', 'en'], home);
  assert.equal(policy.status, 1, policy.stderr);
  const policyJson = JSON.parse(policy.stdout);
  assert.equal(Array.isArray(policyJson.items), true);
  assert.equal(policyJson.failed, true);

  const profileCreate = run(['profile', 'create', 'writing', '--lang', 'en'], home);
  assert.equal(profileCreate.status, 0, profileCreate.stderr);
  const profileList = run(['profile', 'list', '--json', '--lang', 'en'], home);
  assert.equal(profileList.status, 0, profileList.stderr);
  assert.equal(Boolean(JSON.parse(profileList.stdout).profiles.writing), true);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { beta: 'name-only' } }, null, 2));
  const profileDryRun = run(['profile', 'apply', 'writing', '--dry-run', '--lang', 'en'], home);
  assert.equal(profileDryRun.status, 0, profileDryRun.stderr);
  const beforeApply = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  assert.match(beforeApply, /name-only/);
  const profileApply = run(['profile', 'apply', 'writing', '--yes', '--lang', 'en'], home);
  assert.equal(profileApply.status, 0, profileApply.stderr);
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.skillOverrides.beta, 'on');
  const backupRoot = path.join(home, '.skill-manager', 'backups');
  assert.equal(fs.readdirSync(backupRoot).some((name) => name.includes('profile-writing')), true);

  const evalResult = run(['eval', 'beta', '--json', '--lang', 'en'], home);
  assert.equal(evalResult.status, 0, evalResult.stderr);
  assert.equal(JSON.parse(evalResult.stdout).items[0].name, 'beta');
});

test('生命周期：本地来源字段无效时明确提示，避免用户误以为已建立升级源', () => {
  const home = makeHome();
  const source = makeSkillSource('gamma', 'gamma description', '1.0.0', { source: 'not-a-url' });
  const install = run(['install', source, '--tool', 'claude', '--yes', '--lang', 'en'], home);
  assert.equal(install.status, 0, install.stderr);
  assert.match(install.stdout, /ignored invalid source field/);
  assert.match(install.stdout, /has no upgrade source/);
  const sources = JSON.parse(fs.readFileSync(path.join(home, '.skill-manager', 'sources.json'), 'utf8'));
  assert.equal(sources.sources.gamma.version, '1.0.0');
  assert.equal(sources.sources.gamma.source, null);
});

function run(args, home) {
  return spawnSync(process.execPath, ['bin/skm.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, SKM_LANG: 'en' },
  });
}

function runAsync(args, home) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['bin/skm.js', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home, SKM_LANG: 'en' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skm-lifecycle-home-'));
}

function makeSkillSource(name, description, version, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `skm-lifecycle-${name}-`));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd(name, description, version, extra));
  return dir;
}

function skillMd(name, description, version, extra = {}) {
  const fields = [
    `name: ${name}`,
    `description: ${description}`,
    `version: ${version}`,
    extra.source ? `source: ${extra.source}` : null,
    extra.repository ? `repository: ${extra.repository}` : null,
    extra.homepage ? `homepage: ${extra.homepage}` : null,
  ].filter(Boolean).join('\n');
  return `---\n${fields}\n---\n\n${description}\n`;
}

function startSkillServer(textOf) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/SKILL.md') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
    res.end(textOf());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/SKILL.md` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}
