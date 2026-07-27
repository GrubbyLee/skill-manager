import test from 'node:test';
import assert from 'node:assert/strict';
import { installCommand, spawnFailureDetail } from '../scripts/install-process.mjs';

test('安装进程：Unix 直接执行可执行文件', () => {
  assert.deepEqual(installCommand('npmLink', { platform: 'linux' }), {
    command: 'npm',
    args: ['link'],
  });
  assert.deepEqual(installCommand('skmHelp', { platform: 'darwin' }), {
    command: 'skm',
    args: ['help'],
  });
});

test('安装进程：Windows 通过 ComSpec 执行 cmd shim', () => {
  assert.deepEqual(installCommand('npmLink', {
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  }), {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd link'],
  });
  assert.deepEqual(installCommand('skmHelp', { platform: 'win32', env: {} }), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'skm.cmd help'],
  });
});

test('安装进程：失败详情保留启动错误、退出码和信号', () => {
  const spawnError = new Error('spawn npm.cmd ENOENT');
  spawnError.code = 'ENOENT';
  assert.equal(
    spawnFailureDetail({ status: null, signal: null, error: spawnError }, 'en'),
    'spawn error ENOENT: spawn npm.cmd ENOENT',
  );
  assert.equal(
    spawnFailureDetail({ status: 1, signal: 'SIGTERM' }, 'zh-CN'),
    '退出码 1; 信号 SIGTERM',
  );
  assert.equal(spawnFailureDetail({ status: null, signal: null }, 'zh-CN'), '未知进程错误');
});

test('安装进程：拒绝未定义的内部命令', () => {
  assert.throws(() => installCommand('custom'), /未知安装命令/);
});
