import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

test('CLI help：doctor 文案与当前 macOS/Windows CI 策略一致', () => {
  const r = spawnSync(process.execPath, ['bin/skm.js', 'help', '--lang', 'zh-CN'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /macOS\/Windows CI/);
  assert.doesNotMatch(r.stdout, /三端 CI/);
});

test('CLI help：支持英文输出', () => {
  const r = spawnSync(process.execPath, ['bin/skm.js', 'help', '--lang', 'en'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /AIDE skill \/ MCP inventory/);
  assert.match(r.stdout, /Global options:/);
  assert.match(r.stdout, /--lang <zh-CN\|en>/);
  assert.doesNotMatch(r.stdout, /用法：/);
});

test('CLI help：SKM_LANG 可选择中文，且 --lang 优先级更高', () => {
  const zh = spawnSync(process.execPath, ['bin/skm.js', 'help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SKM_LANG: 'zh-CN' },
  });
  assert.equal(zh.status, 0);
  assert.match(zh.stdout, /用法：skm/);

  const en = spawnSync(process.execPath, ['bin/skm.js', 'help', '--lang', 'en'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SKM_LANG: 'zh-CN' },
  });
  assert.equal(en.status, 0);
  assert.match(en.stdout, /Usage: skm/);
});

test('CLI 参数：非法语言 fail fast', () => {
  const r = spawnSync(process.execPath, ['bin/skm.js', 'help', '--lang', 'fr'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(r.status, 1);
  assert.match(r.stderr, /--lang must be zh-CN\|en/);
});
