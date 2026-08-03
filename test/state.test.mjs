import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('state：plan 生成只读状态治理建议', () => {
  const home = makeHome();
  writeCatalog(home, [
    skill({ dirName: 'alpha', tool: 'claude-code', path: path.join(home, '.claude/skills/alpha'), descTokens: 200 }),
    skill({ dirName: 'alpha', tool: 'codex', path: path.join(home, '.codex/skills/alpha'), descTokens: 200 }),
    skill({ dirName: 'beta', tool: 'claude-code', path: path.join(home, '.claude/skills/beta'), descTokens: 10 }),
  ]);

  const r = run(['state', 'plan', '--json', '--lang', 'en'], home);

  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  const alpha = data.items.find((item) => item.name === 'alpha');
  assert.equal(alpha.recommendedMode, 'off');
  assert.match(alpha.command, /skm state set alpha --tool claude --mode off/);
});

test('state：set 写入 Claude Code 原生 skillOverrides 并把 user-only 映射为官方值', () => {
  const home = makeHome();
  const skillDir = path.join(home, '.claude', 'skills', 'alpha');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: alpha\ndescription: alpha\n---\n');
  writeCatalog(home, [skill({ dirName: 'alpha', tool: 'claude-code', path: skillDir, descTokens: 200 })]);

  const r = run(['state', 'set', 'alpha', '--tool', 'claude', '--mode', 'user-only', '--scope', 'user', '--yes', '--lang', 'en'], home);

  assert.equal(r.status, 0, r.stderr);
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.skillOverrides.alpha, 'user-invocable-only');

  const list = run(['state', 'list', '--json', '--lang', 'en'], home);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).items[0].mode, 'user-invocable-only');
});

test('state：Codex 状态暂不自动改写，返回手动操作提示', () => {
  const home = makeHome();
  writeCatalog(home, [skill({ dirName: 'alpha', tool: 'codex', path: path.join(home, '.codex/skills/alpha'), descTokens: 200 })]);

  const r = run(['state', 'set', 'alpha', '--tool', 'codex', '--mode', 'off', '--lang', 'en'], home);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /Codex skill state is not automated yet/);
});

test('state：set 拒绝 plugin scope，避免误写用户设置', () => {
  const home = makeHome();
  writeCatalog(home, [skill({ dirName: 'alpha', tool: 'claude-code', path: path.join(home, '.claude/skills/alpha'), descTokens: 10 })]);

  const r = run(['state', 'set', 'alpha', '--tool', 'claude', '--mode', 'off', '--scope', 'plugin', '--lang', 'en'], home);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /--scope must be user or project/);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false);
});

test('state：set 遇到损坏的 Claude settings 时 fail fast，不覆盖原文件', () => {
  const home = makeHome();
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsFile = path.join(claudeDir, 'settings.json');
  fs.writeFileSync(settingsFile, '{bad json');
  writeCatalog(home, [skill({ dirName: 'alpha', tool: 'claude-code', path: path.join(home, '.claude/skills/alpha'), descTokens: 10 })]);

  const r = run(['state', 'set', 'alpha', '--tool', 'claude', '--mode', 'off', '--scope', 'user', '--yes', '--lang', 'en'], home);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /Failed to parse Claude settings/);
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{bad json');
});

function run(args, home) {
  return spawnSync(process.execPath, ['bin/skm.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, SKM_LANG: 'en' },
  });
}

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-state-home-'));
  fs.mkdirSync(path.join(home, '.skill-manager'), { recursive: true });
  return home;
}

function writeCatalog(home, skills) {
  fs.writeFileSync(path.join(home, '.skill-manager', 'catalog.json'), JSON.stringify({
    version: 1,
    scannedAt: '2026-07-20T00:00:00Z',
    skills,
    mcpServers: [],
    security: { summary: { high: 0, medium: 0, low: 0, info: 0 }, findings: [] },
    warnings: [],
  }, null, 2));
}

function skill({ dirName, tool, path: filePath, descTokens }) {
  return {
    dirName,
    name: dirName,
    tool,
    scope: 'user',
    path: filePath,
    realPath: filePath,
    category: '研发辅助',
    description: `${dirName} skill`,
    descTokens,
    upstream: {},
    securityFindings: [],
  };
}
