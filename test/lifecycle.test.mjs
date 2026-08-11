import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { KIMI_DESKTOP_SKILLS_DIR, KIMI_DESKTOP_SKILLS_DIRS } from '../src/paths.js';

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

test('生命周期：lock diff/verify 能发现当前 skill 与基线漂移', () => {
  const home = makeHome();
  const source = makeSkillSource('delta', 'delta description', '1.0.0');
  assert.equal(run(['install', source, '--tool', 'claude', '--yes', '--lang', 'en'], home).status, 0);
  assert.equal(run(['lock', '--lang', 'en'], home).status, 0);

  const cleanVerify = run(['lock', 'verify', '--json', '--lang', 'en'], home);
  assert.equal(cleanVerify.status, 0, cleanVerify.stderr);
  assert.equal(JSON.parse(cleanVerify.stdout).summary.verified, true);

  const target = path.join(home, '.claude', 'skills', 'delta', 'SKILL.md');
  fs.writeFileSync(target, skillMd('delta', 'delta changed', '1.0.1'));

  const driftVerify = run(['lock', 'verify', '--json', '--lang', 'en'], home);
  assert.equal(driftVerify.status, 1, driftVerify.stderr);
  const drift = JSON.parse(driftVerify.stdout);
  assert.equal(drift.summary.verified, false);
  assert.equal(drift.summary.changed, 1);
  assert.deepEqual(drift.changed[0].fields.sort(), ['skillMdHash', 'version']);

  const diff = run(['lock', 'diff', '--json', '--lang', 'en'], home);
  assert.equal(diff.status, 0, diff.stderr);
  assert.equal(JSON.parse(diff.stdout).changed[0].name, 'delta');
});

test('生命周期：lock verify 按安装实例发现同名多端 skill 漂移', () => {
  const home = makeHome();
  const claudeSource = makeSkillSource('multi', 'claude copy', '1.0.0');
  const codexSource = makeSkillSource('multi', 'codex copy', '2.0.0');
  assert.equal(run(['install', claudeSource, '--tool', 'claude', '--yes', '--lang', 'en'], home).status, 0);
  assert.equal(run(['install', codexSource, '--tool', 'codex', '--yes', '--lang', 'en'], home).status, 0);
  assert.equal(run(['lock', '--lang', 'en'], home).status, 0);

  const target = path.join(home, '.codex', 'skills', 'multi', 'SKILL.md');
  fs.writeFileSync(target, skillMd('multi', 'codex changed', '3.0.0'));

  const verify = run(['lock', 'verify', '--json', '--lang', 'en'], home);
  assert.equal(verify.status, 1, verify.stderr);
  const report = JSON.parse(verify.stdout);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.changed[0].name, 'multi');
  assert.equal(report.changed[0].label, 'multi (codex/user)');
});

test('生命周期：lock diff/verify 拒绝重复锁定 key，避免对比时覆盖', () => {
  const home = makeHome();
  const source = makeSkillSource('dup-lock', 'dup description', '1.0.0');
  assert.equal(run(['install', source, '--tool', 'claude', '--yes', '--lang', 'en'], home).status, 0);
  const lock = run(['lock', '--json', '--lang', 'en'], home);
  assert.equal(lock.status, 0, lock.stderr);
  const data = JSON.parse(lock.stdout);
  data.items.push({ ...data.items[0] });
  fs.mkdirSync(path.join(home, '.skill-manager'), { recursive: true });
  fs.writeFileSync(path.join(home, '.skill-manager', 'skill-lock.json'), JSON.stringify(data, null, 2));

  const verify = run(['lock', 'verify', '--json', '--lang', 'en'], home);
  assert.equal(verify.status, 1);
  assert.match(verify.stderr, /duplicate entry/);
  assert.equal(verify.stdout, '');
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

test('生命周期：WorkBuddy 与 Kimi 目录可扫描，Kimi 安装 dry-run 覆盖三类目标', () => {
  const home = makeHome();
  const env = envFor(home);

  writeSkill(path.join(home, '.workbuddy', 'skills', 'workbuddy-demo'), 'workbuddy-demo', 'WorkBuddy demo skill');
  writeJson(path.join(home, '.workbuddy', 'mcp.json'), {
    mcpServers: { 'workbuddy-mcp': { command: 'workbuddy-mcp' } },
  });
  writeSkill(path.join(home, '.kimi', 'skills', 'kimi-cli-demo'), 'kimi-cli-demo', 'Kimi CLI demo skill');
  writeSkill(path.join(home, '.kimi-code', 'skills', 'kimi-code-demo'), 'kimi-code-demo', 'Kimi Code demo skill');
  writeSkill(path.join(home, '.agents', 'skills', 'kimi-agents-demo'), 'kimi-agents-demo', 'Kimi shared agents demo skill');
  writeSkill(path.join(kimiDesktopSkillsRoot(home), 'kimi-desktop-demo'), 'kimi-desktop-demo', 'Kimi Desktop demo skill');
  writeJson(path.join(home, '.kimi-code', 'mcp.json'), {
    mcpServers: { 'kimi-mcp': { command: 'kimi-mcp' } },
  });

  const scan = runWithEnv(['scan', '--json', '--lang', 'en'], env);
  assert.equal(scan.status, 0, scan.stderr);
  const catalog = JSON.parse(scan.stdout);
  const skillKeys = new Set(catalog.skills.map((skill) => `${skill.tool}:${skill.dirName}`));
  assert.equal(skillKeys.has('workbuddy:workbuddy-demo'), true);
  assert.equal(skillKeys.has('kimi:kimi-cli-demo'), true);
  assert.equal(skillKeys.has('kimi:kimi-code-demo'), true);
  assert.equal(skillKeys.has('kimi:kimi-agents-demo'), true);
  assert.equal(skillKeys.has('kimi:kimi-desktop-demo'), true);
  assert.equal(catalog.mcpServers.some((mcp) => mcp.tool === 'workbuddy' && mcp.name === 'workbuddy-mcp'), true);
  assert.equal(catalog.mcpServers.some((mcp) => mcp.tool === 'kimi' && mcp.name === 'kimi-mcp'), true);

  const source = makeSkillSource('omega', 'omega description', '1.0.0');
  const workbuddyPlan = runWithEnv(['install', source, '--tool', 'workbuddy', '--dry-run', '--lang', 'en'], env);
  assert.equal(workbuddyPlan.status, 0, workbuddyPlan.stderr);
  assert.match(workbuddyPlan.stdout, /workbuddy\/user/);

  const kimiPlan = runWithEnv(['install', source, '--tool', 'kimi', '--dry-run', '--lang', 'en'], env);
  assert.equal(kimiPlan.status, 0, kimiPlan.stderr);
  assert.match(kimiPlan.stdout, /kimi\/cli/);
  assert.match(kimiPlan.stdout, /kimi\/code/);
  assert.match(kimiPlan.stdout, /kimi\/desktop/);
  assert.equal(KIMI_DESKTOP_SKILLS_DIRS.length, 1);
  assert.equal(KIMI_DESKTOP_SKILLS_DIRS[0], KIMI_DESKTOP_SKILLS_DIR);
});

test('生命周期：Kimi 兼容目录按真实路径去重，软链指向同一目录时不重复入库', () => {
  const home = makeHome();
  const env = envFor(home);

  writeSkill(path.join(home, '.kimi-code', 'skills', 'kimi-code-demo'), 'kimi-code-demo', 'Kimi Code demo skill');
  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.symlinkSync(path.join(home, '.kimi-code', 'skills'), path.join(home, '.agents', 'skills'), 'dir');

  const scan = runWithEnv(['scan', '--json', '--lang', 'en'], env);
  assert.equal(scan.status, 0, scan.stderr);
  const catalog = JSON.parse(scan.stdout);
  const kimiEntries = catalog.skills.filter((skill) => skill.tool === 'kimi' && skill.dirName === 'kimi-code-demo');
  assert.equal(kimiEntries.length, 1);
});

function run(args, home) {
  return runWithEnv(args, envFor(home));
}

function runWithEnv(args, env) {
  return spawnSync(process.execPath, ['bin/skm.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });
}

function runAsync(args, home) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['bin/skm.js', ...args], {
      cwd: process.cwd(),
      env: envFor(home),
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

function envFor(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, SKM_LANG: 'en' };
  if (process.platform === 'win32') env.APPDATA = path.join(home, 'AppData', 'Roaming');
  return env;
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

function writeSkill(dir, name, description) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd(name, description, '1.0.0'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function kimiDesktopSkillsRoot(home) {
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'kimi-desktop', 'daimon-share', 'daimon', 'skills');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'kimi-desktop', 'daimon-share', 'daimon', 'skills');
  }
  return path.join(home, '.config', 'kimi-desktop', 'daimon-share', 'daimon', 'skills');
}
