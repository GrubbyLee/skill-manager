import test from 'node:test';
import assert from 'node:assert/strict';
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
