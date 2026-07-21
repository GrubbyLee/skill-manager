#!/usr/bin/env node
// 本地源码安装入口：显式运行时才执行 npm link，避免 npm install 自动改动全局环境。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const binPath = path.join(root, 'bin', 'skm.js');
const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`skm 本地安装脚本

用法：
  node scripts/install.mjs
  node scripts/install.mjs --dry-run

说明：
  该脚本会在当前仓库执行 npm link，让 skm 命令在本机可用。
  它不会扫描、清理、禁用或修改 Claude/Codex 数据。`);
  process.exit(0);
}

const dryRun = args.has('--dry-run');
const unsupported = [...args].filter((arg) => !['--dry-run'].includes(arg));
if (unsupported.length > 0) fail(`未知参数：${unsupported.join(' ')}。运行 node scripts/install.mjs --help 查看用法。`);

if (Number(process.versions.node.split('.')[0]) < 18) fail(`Node.js 版本过低：当前 ${process.version}，要求 >= 18。`);
if (!fs.existsSync(pkgPath)) fail(`未找到 package.json：${pkgPath}`);
if (!fs.existsSync(binPath)) fail(`未找到 CLI 入口：${binPath}`);

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.name !== 'aide-skill-manager') fail(`package.json name 异常：${pkg.name}`);
if (!pkg.bin || pkg.bin.skm !== './bin/skm.js') fail('package.json 缺少 bin.skm 配置。');
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) fail('package.json 不应包含 dependencies。');

console.log('skm 本地安装检查通过');
console.log(`项目目录：${root}`);
console.log(`Node.js：${process.version}`);
console.log('即将执行：npm link');

if (dryRun) {
  console.log('[dry-run] 未执行安装。');
  process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const linked = spawnSync(npm, ['link'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (linked.status !== 0) {
  fail(`npm link 执行失败，退出码：${linked.status ?? '未知'}`);
}

const checked = spawnSync(process.platform === 'win32' ? 'skm.cmd' : 'skm', ['help'], {
  cwd: root,
  stdio: 'ignore',
  shell: false,
});

if (checked.status !== 0) {
  console.log('npm link 已完成，但 skm help 验证未通过。可以尝试重新打开终端后运行 skm help。');
  process.exit(0);
}

console.log('安装完成。可以运行：');
console.log('  skm scan');
console.log('  skm ask "我要把网页转成 Markdown"');
console.log('  skm graph --format html --output skill-graph.html');

function fail(message) {
  console.error(`安装失败：${message}`);
  process.exit(1);
}
