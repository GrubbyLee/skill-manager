#!/usr/bin/env node
// 本地源码安装入口：显式运行时才执行 npm link，避免 npm install 自动改动全局环境。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { langFromArgv, tr } from '../src/i18n.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const binPath = path.join(root, 'bin', 'skm.js');
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const lang = langFromArgv(rawArgs);
const explicitLangValue = readExplicitLangValue(rawArgs);

if (explicitLangValue !== undefined && !lang) fail(tr(null, 'cli.langInvalid', { value: explicitLangValue ?? '(missing)' }));

if (args.has('--help') || args.has('-h')) {
  console.log(lang === 'en' ? `skm local install script

Usage:
  node scripts/install.mjs
  node scripts/install.mjs --dry-run
  node scripts/install.mjs --lang zh-CN

Notes:
  This script runs npm link in the current repository so the skm command is available locally.
  It does not scan, clean, disable, or modify Claude/Codex data.` : `${tr(lang, 'install.title')}

${tr(lang, 'install.usage')}
  node scripts/install.mjs
  node scripts/install.mjs --dry-run
  node scripts/install.mjs --lang en

${tr(lang, 'install.desc')}
  ${tr(lang, 'install.descText')}`);
  process.exit(0);
}

const dryRun = args.has('--dry-run');
const unsupported = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--dry-run') continue;
  if (arg === '--lang') {
    i++;
    continue;
  }
  if (arg.startsWith('--lang=')) continue;
  unsupported.push(arg);
}
if (unsupported.length > 0) fail(tr(lang, 'install.unknownArg', { args: unsupported.join(' ') }));

if (Number(process.versions.node.split('.')[0]) < 18) fail(tr(lang, 'install.nodeTooOld', { version: process.version }));
if (!fs.existsSync(pkgPath)) fail(tr(lang, 'install.missingPackage', { file: pkgPath }));
if (!fs.existsSync(binPath)) fail(tr(lang, 'install.missingBin', { file: binPath }));

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.name !== 'aide-skill-manager') fail(tr(lang, 'install.badName', { name: pkg.name }));
if (!pkg.bin || pkg.bin.skm !== './bin/skm.js') fail(tr(lang, 'install.missingBinConfig'));
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) fail(tr(lang, 'install.dependencies'));

console.log(tr(lang, 'install.checkOk'));
console.log(tr(lang, 'install.projectDir', { root }));
console.log(lang === 'en' ? `Node.js: ${process.version}` : `Node.js：${process.version}`);
console.log(tr(lang, 'install.willRun'));

if (dryRun) {
  console.log(tr(lang, 'install.dryRun'));
  process.exit(0);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const linked = spawnSync(npm, ['link'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (linked.status !== 0) {
  fail(lang === 'en' ? `npm link failed, exit code: ${linked.status ?? 'unknown'}` : `npm link 执行失败，退出码：${linked.status ?? '未知'}`);
}

const checked = spawnSync(process.platform === 'win32' ? 'skm.cmd' : 'skm', ['help'], {
  cwd: root,
  stdio: 'ignore',
  shell: false,
});

if (checked.status !== 0) {
  console.log(tr(lang, 'install.verifyFailed'));
  process.exit(0);
}

console.log(tr(lang, 'install.done'));
console.log('  skm scan');
console.log(lang === 'en' ? '  skm ask "convert a web page to Markdown"' : '  skm ask "我要把网页转成 Markdown"');
console.log('  skm graph --format html --output skill-graph.html');

function fail(message) {
  console.error(tr(lang, 'install.fail', { message }));
  process.exit(1);
}

function readExplicitLangValue(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang') return argv[i + 1] ?? null;
    if (arg.startsWith('--lang=')) return arg.slice('--lang='.length);
  }
  return undefined;
}
