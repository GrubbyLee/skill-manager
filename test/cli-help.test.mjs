import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

test('CLI help：doctor 文案与当前 macOS/Windows CI 策略一致', () => {
  const r = spawnSync(process.execPath, ['bin/skm.js', 'help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /macOS\/Windows CI/);
  assert.doesNotMatch(r.stdout, /三端 CI/);
});
