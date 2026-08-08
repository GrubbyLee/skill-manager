import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileStamp } from '../utils.js';
import { tr } from '../i18n.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bridgeSkillName = 'skill-navigator';
const bridgeSkillSource = path.join(root, 'integrations', bridgeSkillName);

// skm setup：npm 安装后显式安装桥接 skill。该命令只写用户 skill 目录，不修改 AIDE 配置/MCP/会话日志。
export function runSetup(opts = {}) {
  const dryRun = Boolean(opts.dryRun || opts['dry-run']);
  const lang = opts.lang || 'zh-CN';
  if (!fs.existsSync(bridgeSkillSource)) {
    throw new Error(tr(lang, 'setup.missingBridgeSkill', { dir: bridgeSkillSource }));
  }

  const targets = bridgeSkillTargets();
  console.log(tr(lang, 'setup.title'));
  const version = readBridgeSkillVersion();
  if (version) console.log(tr(lang, 'setup.bridgeVersion', { version }));
  console.log(tr(lang, 'setup.bridgePlan', { name: bridgeSkillName }));
  for (const target of targets) {
    const prefix = dryRun ? '[dry-run] ' : '';
    console.log(`  ${prefix}${target.tool}: ${target.dir}`);
  }

  if (dryRun) {
    console.log(tr(lang, 'setup.dryRun'));
    return;
  }

  const installed = [];
  for (const target of targets) {
    const result = installOneBridgeSkill(target);
    installed.push(result);
    if (result.action === 'created') console.log(tr(lang, 'setup.bridgeCreated', result));
    else if (result.action === 'same') console.log(tr(lang, 'setup.bridgeSame', result));
    else if (result.action === 'replaced') console.log(tr(lang, 'setup.bridgeReplaced', result));
  }
  console.log(tr(lang, 'setup.done', { count: installed.length }));
}

function readBridgeSkillVersion() {
  try {
    const skillPath = path.join(bridgeSkillSource, 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf8');
    const match = content.match(/^version:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function bridgeSkillTargets() {
  return [
    { tool: 'Claude Code', dir: path.join(os.homedir(), '.claude', 'skills', bridgeSkillName) },
    { tool: 'Codex', dir: path.join(os.homedir(), '.codex', 'skills', bridgeSkillName) },
  ];
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
