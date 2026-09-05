import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanPiFile } from '../src/usage.js';
import { scanPi } from '../src/adapters/pi.js';
import { resolvePiSessionRoot } from '../src/paths.js';

const CLI = path.resolve('bin/skm.js');

test('Pi：扫描全局/项目 skills，并支持安装 dry-run', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-pi-'));
  try {
    writeSkill(path.join(home, '.pi', 'agent', 'skills', 'pi-global'), 'pi-global');
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'skills', 'root-file.md'), '---\nname: root-file\ndescription: root file skill\n---\n');
    writeSkill(path.join(home, '.pi', 'agent', 'custom-configured'), 'pi-configured');
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'custom-file.md'), '---\nname: custom-file\ndescription: configured file skill\n---\n');
    writeSkill(path.join(home, '.pi', 'agent', 'npm', 'local-package', 'skills', 'packaged'), 'packaged');
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'npm', 'local-package', 'package.json'), JSON.stringify({ name: 'local-package' }));
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({ skills: ['./custom-configured', './custom-file.md'], packages: ['local-package'] }));
    writeSkill(path.join(home, '.agents', 'skills', 'shared'), 'shared');
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-pi-project-'));
    try {
      writeSkill(path.join(project, '.pi', 'skills', 'pi-project'), 'pi-project');
      const result = run(['scan', '--json', '--lang', 'en'], project, home);
      assert.equal(result.status, 0, result.stderr);
      const catalog = JSON.parse(result.stdout);
      const names = catalog.skills.filter((s) => s.tool === 'pi').map((s) => s.dirName);
      assert.deepEqual(names.sort(), ['custom-configured', 'custom-file', 'packaged', 'pi-global', 'pi-project', 'root-file', 'shared']);

      const source = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-pi-source-'));
      writeSkill(source, 'new-pi-skill');
      const plan = run(['install', source, '--tool', 'pi', '--dry-run', '--lang', 'en'], project, home);
      assert.equal(plan.status, 0, plan.stderr);
      assert.match(plan.stdout, /pi\/user/);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Pi：项目 skill 只沿 Git 根向上查找，不收录仓库外层目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-pi-boundary-'));
  try {
    writeSkill(path.join(root, '.pi', 'skills', 'outside'), 'outside');
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.git', 'objects'), { recursive: true });
    writeSkill(path.join(repo, '.pi', 'skills', 'inside'), 'inside');
    const catalog = scanPi({ cwd: path.join(repo, 'nested') });
    const names = catalog.skills.filter((skill) => skill.scope === 'project').map((skill) => skill.dirName);
    assert.deepEqual(names, ['inside']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pi：会话目录尊重环境变量和项目 settings.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-pi-session-root-'));
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  try {
    process.env.PI_CODING_AGENT_SESSION_DIR = path.join(root, 'env-sessions');
    assert.equal(resolvePiSessionRoot(root), path.join(root, 'env-sessions'));
    delete process.env.PI_CODING_AGENT_SESSION_DIR;
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, '.pi'), { recursive: true });
    fs.writeFileSync(path.join(root, '.pi', 'settings.json'), JSON.stringify({ sessionDir: './project-sessions' }));
    assert.equal(resolvePiSessionRoot(path.join(root, 'src')), path.join(root, '.pi', 'project-sessions'));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pi：会话中的 read toolCall 只统计实际读取的 skill', () => {
  const file = path.join(os.tmpdir(), `skm-pi-session-${Date.now()}.jsonl`);
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'session', cwd: '/tmp/project', timestamp: '2026-09-01T00:00:00Z' }),
    JSON.stringify({ type: 'message', timestamp: '2026-09-01T00:01:00Z', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', arguments: { path: '/home/u/.pi/agent/skills/demo/SKILL.md' } }] } }),
    JSON.stringify({ type: 'message', timestamp: '2026-09-01T00:02:00Z', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'cat /home/u/.pi/agent/skills/demo/SKILL.md' } }] } }),
  ].join('\n'));
  try {
    const report = scanPiFile(file);
    assert.deepEqual(report.skills.demo, { count: 1, lastUsed: '2026-09-01T00:02:00Z' });
  } finally {
    fs.rmSync(file, { force: true });
  }
});

function writeSkill(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} test skill\n---\n`);
}

function run(args, cwd, home) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, KIMI_CODE_HOME: path.join(home, '.kimi-code') },
  });
}
