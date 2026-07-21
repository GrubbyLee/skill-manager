import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { collectDoctor } from '../src/commands/doctor.js';

test('doctor：检查 Node、零依赖与 advisor 可用性', () => {
  const spawnImpl = (cmd) => {
    if (cmd === 'codex') return { status: 0, stdout: 'codex 1.0.0\n', stderr: '' };
    if (cmd === 'claude') return { error: Object.assign(new Error('not found'), { code: 'ENOENT' }) };
    return { status: 1, stdout: '', stderr: '' };
  };

  const report = collectDoctor({ cwd: process.cwd(), spawnImpl, nodeVersion: '18.19.0' });
  assert.equal(report.checks.find((c) => c.name === 'Node.js 版本').status, 'ok');
  assert.equal(report.checks.find((c) => c.name === '零第三方依赖').status, 'ok');
  assert.equal(report.checks.find((c) => c.name === 'codex advisor').status, 'ok');
  assert.equal(report.checks.find((c) => c.name === 'claude advisor').status, 'warn');
  assert.ok(report.nextSteps.some((s) => s.includes('codex / claude')));
});

test('doctor：Node 版本过低时失败', () => {
  const report = collectDoctor({
    cwd: process.cwd(),
    spawnImpl: () => ({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }) }),
    nodeVersion: '16.20.0',
  });
  assert.equal(report.checks.find((c) => c.name === 'Node.js 版本').status, 'fail');
  assert.ok(report.summary.fail >= 1);
});

test('doctor --json：结构化输出不随 --lang 改变', () => {
  const zh = spawnSync(process.execPath, ['bin/skm.js', 'doctor', '--json', '--lang', 'zh-CN'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const en = spawnSync(process.execPath, ['bin/skm.js', 'doctor', '--json', '--lang', 'en'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(zh.status, 0);
  assert.equal(en.status, 0);
  assert.deepEqual(
    JSON.parse(en.stdout).checks.map((c) => c.name),
    JSON.parse(zh.stdout).checks.map((c) => c.name),
  );
  assert.ok(JSON.parse(en.stdout).checks.some((c) => c.name === 'Node.js 版本'));
});
