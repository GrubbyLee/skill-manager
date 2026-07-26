#!/usr/bin/env node
// 本地源码安装入口：显式运行时才执行 npm link，避免 npm install 自动改动全局环境。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { langFromArgv, tr } from '../src/i18n.js';
import { fileStamp } from '../src/utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const binPath = path.join(root, 'bin', 'skm.js');
const bridgeSkillName = 'skill-navigator';
const bridgeSkillSource = path.join(root, 'integrations', bridgeSkillName);
const bridgeSkillTargets = [
  { tool: 'Claude Code', dir: path.join(os.homedir(), '.claude', 'skills', bridgeSkillName) },
  { tool: 'Codex', dir: path.join(os.homedir(), '.codex', 'skills', bridgeSkillName) },
];
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
  It also installs the bundled skill-navigator bridge skill into Claude Code and Codex user skill directories.
  It does not scan, clean, disable, or modify Claude/Codex configs, MCP servers, or session logs.` : `${tr(lang, 'install.title')}

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
if (!fs.existsSync(bridgeSkillSource)) fail(tr(lang, 'install.missingBridgeSkill', { dir: bridgeSkillSource }));

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.name !== 'aide-skill-manager') fail(tr(lang, 'install.badName', { name: pkg.name }));
if (!pkg.bin || pkg.bin.skm !== './bin/skm.js') fail(tr(lang, 'install.missingBinConfig'));
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) fail(tr(lang, 'install.dependencies'));

console.log(tr(lang, 'install.checkOk'));
console.log(tr(lang, 'install.projectDir', { root }));
console.log(lang === 'en' ? `Node.js: ${process.version}` : `Node.js：${process.version}`);
console.log(tr(lang, 'install.willRun'));
printBridgeSkillPlan({ dryRun });

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

installBridgeSkill();

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

function printBridgeSkillPlan({ dryRun }) {
  console.log(tr(lang, 'install.bridgePlan', { name: bridgeSkillName }));
  for (const target of bridgeSkillTargets) {
    const prefix = dryRun ? '[dry-run] ' : '';
    console.log(`  ${prefix}${target.tool}: ${target.dir}`);
  }
}

function installBridgeSkill() {
  const installed = [];
  for (const target of bridgeSkillTargets) {
    const result = installOneBridgeSkill(target);
    installed.push(result);
    if (result.action === 'created') console.log(tr(lang, 'install.bridgeCreated', result));
    else if (result.action === 'same') console.log(tr(lang, 'install.bridgeSame', result));
    else if (result.action === 'replaced') console.log(tr(lang, 'install.bridgeReplaced', result));
  }
  console.log(tr(lang, 'install.bridgeDone', { count: installed.length }));
}

function installOneBridgeSkill(target) {
  const parent = path.dirname(target.dir);
  const sourceFiles = relativeFiles(bridgeSkillSource);
  if (!fs.existsSync(target.dir)) {
    fs.mkdirSync(parent, { recursive: true });
    fs.cpSync(bridgeSkillSource, target.dir, { recursive: true });
    return { ...target, action: 'created' };
  }

  if (sameDirectoryContent(bridgeSkillSource, target.dir, sourceFiles)) {
    return { ...target, action: 'same' };
  }

  const backup = nextBackupPath(target.dir);
  fs.renameSync(target.dir, backup);
  fs.mkdirSync(parent, { recursive: true });
  fs.cpSync(bridgeSkillSource, target.dir, { recursive: true });
  return { ...target, action: 'replaced', backup };
}

function sameDirectoryContent(sourceDir, targetDir, sourceFiles) {
  let targetFiles;
  try {
    targetFiles = relativeFiles(targetDir);
  } catch {
    return false;
  }
  if (sourceFiles.length !== targetFiles.length) return false;
  for (let i = 0; i < sourceFiles.length; i++) {
    if (sourceFiles[i] !== targetFiles[i]) return false;
    let sourceData;
    let targetData;
    try {
      sourceData = fs.readFileSync(path.join(sourceDir, sourceFiles[i]));
      targetData = fs.readFileSync(path.join(targetDir, targetFiles[i]));
    } catch {
      return false;
    }
    if (!sourceData.equals(targetData)) return false;
  }
  return true;
}

function relativeFiles(dir) {
  const out = [];
  const walk = (current, prefix = '') => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const rel = path.join(prefix, ent.name);
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) walk(full, rel);
      else if (ent.isFile()) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

function nextBackupPath(dir) {
  const base = `${dir}-backup-${fileStamp()}`;
  let candidate = base;
  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = `${base}-${i}`;
    i++;
  }
  return candidate;
}
