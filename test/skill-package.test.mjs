import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditSkillDirectory } from '../src/securityAudit.js';
import { buildPackageManifest, diffPackageManifests, installationId, validateSkillPackage } from '../src/skillPackage.js';
import { atomicReplaceDirectories, atomicReplaceDirectory, prepareCandidate } from '../src/skillSource.js';

test('skill package：目录 hash 和 diff 覆盖 scripts/assets，而不只覆盖 SKILL.md', () => {
  const dir = makeSkillDir();
  const before = buildPackageManifest(dir);
  fs.writeFileSync(path.join(dir, 'scripts', 'run.js'), 'console.log("v2")\n');
  fs.writeFileSync(path.join(dir, 'assets', 'new.txt'), 'new\n');
  const after = buildPackageManifest(dir);
  const diff = diffPackageManifests(before, after);
  assert.notEqual(after.hash, before.hash);
  assert.deepEqual(diff.changed, ['scripts/run.js']);
  assert.deepEqual(diff.added, ['assets/new.txt']);
});

test('skill package：静态安全审计覆盖 scripts 文件并记录证据路径', () => {
  const dir = makeSkillDir();
  fs.writeFileSync(path.join(dir, 'scripts', 'danger.sh'), 'rm -rf /\n');
  const skill = { dirName: 'package-demo', hasFrontmatter: true, description: 'demo' };
  const findings = auditSkillDirectory(dir, skill);
  assert.equal(findings.some((item) => item.ruleId === 'skill.destructiveCommand' && item.targetFile === 'scripts/danger.sh'), true);
});

test('skill package：单文件候选保留现有资源，原子替换后目录完整', () => {
  const target = makeSkillDir();
  const candidate = prepareCandidate({ kind: 'single-file', text: skillMd('v2') }, target, copyDir);
  atomicReplaceDirectory(candidate.stage, target);
  assert.equal(fs.existsSync(path.join(target, 'scripts', 'run.js')), true);
  assert.match(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), /v2/);
});

test('skill package：安装实例 ID 包含位置身份', () => {
  const a = installationId({ tool: 'codex', scope: 'user', dirName: 'demo', path: '/tmp/a/demo' });
  const b = installationId({ tool: 'codex', scope: 'user', dirName: 'demo', path: '/tmp/b/demo' });
  assert.notEqual(a, b);
});

test('skill package：候选准备失败会清理隐藏暂存目录', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-stage-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target');

  assert.throws(() => prepareCandidate({ kind: 'directory', sourceDir: root }, target, (_from, stage) => {
    fs.mkdirSync(stage);
    fs.writeFileSync(path.join(stage, 'partial.txt'), 'partial');
    throw new Error('copy failed');
  }), /copy failed/);
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.startsWith('.skm-stage-')), []);
});

test('skill package：成组替换失败时恢复已经移动的全部目标', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-group-atomic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  const firstStage = path.join(root, '.first-stage');
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  fs.mkdirSync(firstStage);
  fs.writeFileSync(path.join(first, 'value.txt'), 'old-first');
  fs.writeFileSync(path.join(second, 'value.txt'), 'old-second');
  fs.writeFileSync(path.join(firstStage, 'value.txt'), 'new-first');

  assert.throws(() => atomicReplaceDirectories([
    { stage: firstStage, targetDir: first },
    { stage: path.join(root, '.missing-stage'), targetDir: second },
  ]));
  assert.equal(fs.readFileSync(path.join(first, 'value.txt'), 'utf8'), 'old-first');
  assert.equal(fs.readFileSync(path.join(second, 'value.txt'), 'utf8'), 'old-second');
});

test('skill package：拒绝指向包外的内部软链', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-package-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'SKILL.md'), '---\nname: linked\n---\n');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'inside.txt'), 'inside');
  fs.symlinkSync('assets/inside.txt', path.join(root, 'inside-link'));
  assert.doesNotThrow(() => validateSkillPackage(root));

  fs.symlinkSync('../outside.txt', path.join(root, 'outside-link'));
  assert.throws(() => validateSkillPackage(root), /symlink escapes package/);
});

function makeSkillDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-package-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd('v1'));
  fs.writeFileSync(path.join(dir, 'scripts', 'run.js'), 'console.log("v1")\n');
  return dir;
}

function skillMd(version) {
  return `---\nname: package-demo\ndescription: package demo\nversion: ${version}\n---\n`;
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
}
