#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    skillDir: 'integrations/skill-navigator',
    output: '.skill-release',
    archive: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skill-dir') out.skillDir = argv[++i];
    else if (arg === '--output') out.output = argv[++i];
    else if (arg === '--archive') out.archive = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`用法：node scripts/prepare-skill-release.mjs [选项]

选项：
  --skill-dir <dir>   skill 目录，默认 integrations/skill-navigator
  --output <dir>      输出目录，默认 .skill-release
  --archive           若系统存在 zip，则额外生成 zip 包
  --json              输出机器可读 JSON
`);
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return out;
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function extractFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('SKILL.md 缺少 frontmatter');
  const data = {};
  let currentKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      currentKey = pair[1];
      const value = pair[2].trim();
      data[currentKey] = value || [];
      continue;
    }
    const item = line.match(/^\s*-\s+(.+)$/);
    if (item && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(item[1].trim());
    }
  }
  return data;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function commandExists(name) {
  const pathValue = process.env.PATH || '';
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (fs.existsSync(path.join(dir, `${name}${ext}`))) return true;
    }
  }
  return false;
}

function makeArchive(outputDir, skillName) {
  if (!commandExists('zip')) return null;
  const archive = path.join(outputDir, `${skillName}.zip`);
  const result = spawnSync('zip', ['-qr', archive, skillName], { cwd: outputDir, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('zip 打包失败');
  return archive;
}

function validateNoObviousSecrets(files) {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
  ];
  for (const file of files) {
    const text = readText(file);
    for (const pattern of patterns) {
      if (pattern.test(text)) throw new Error(`疑似密钥不应进入发布包：${path.relative(root, file)}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillDir = path.resolve(root, args.skillDir);
  const outputDir = path.resolve(root, args.output);
  const packageJson = readJson(path.join(root, 'package.json'));
  const required = ['SKILL.md', 'README.md', 'README.zh-CN.md', 'skillhub.json'];

  if (!fs.existsSync(skillDir)) throw new Error(`skill 目录不存在：${args.skillDir}`);
  for (const name of required) {
    const file = path.join(skillDir, name);
    if (!fs.existsSync(file)) throw new Error(`缺少发布文件：${path.relative(root, file)}`);
  }

  const skillFile = path.join(skillDir, 'SKILL.md');
  const skill = extractFrontmatter(readText(skillFile));
  const hub = readJson(path.join(skillDir, 'skillhub.json'));
  const errors = [];
  const warnings = [];
  const skillsHubCategories = new Set([
    'build', 'test', 'qa', 'review', 'deploy', 'docs', 'security', 'ux', 'analysis',
    'productivity', 'integration', 'ops', 'combo', 'meta', 'marketing', 'product',
    'creative', 'data', 'business', 'healthcare', 'accessibility', 'gamedev',
    'research', 'education',
  ]);

  for (const key of ['name', 'version', 'description', 'category', 'homepage', 'source']) {
    if (!skill[key]) errors.push(`SKILL.md 缺少 ${key}`);
  }
  if (!Array.isArray(skill.platforms) || skill.platforms.length === 0) errors.push('SKILL.md 缺少 platforms 列表');
  if (skill.name !== hub.name) errors.push(`SKILL.md name 与 skillhub.json name 不一致：${skill.name} / ${hub.name}`);
  if (skill.version !== hub.version) errors.push(`SKILL.md version 与 skillhub.json version 不一致：${skill.version} / ${hub.version}`);
  if (skill.version !== packageJson.version) errors.push(`skill 版本与 package.json 不一致：${skill.version} / ${packageJson.version}`);
  if (hub.source !== skill.source) errors.push('skillhub.json source 与 SKILL.md source 不一致');
  if (skill.category && !skillsHubCategories.has(skill.category)) errors.push(`SKILL.md category 不是 skills-hub.ai 合法分类：${skill.category}`);
  if (!String(skill.source).startsWith('https://github.com/GrubbyLee/skill-manager/')) warnings.push('source 不是 GitHub 主仓目录，请确认是否故意修改');
  if (!Array.isArray(hub.tags) || hub.tags.length < 5) warnings.push('skillhub.json tags 数量偏少，可能影响平台检索');

  validateNoObviousSecrets(required.map((name) => path.join(skillDir, name)));

  if (errors.length) {
    for (const error of errors) console.error(`错误：${error}`);
    process.exit(1);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const stagedDir = path.join(outputDir, skill.name);
  copyDir(skillDir, stagedDir);

  const summary = `# skill-navigator 发布包

- 名称：${skill.name}
- 版本：${skill.version}
- npm 包：${packageJson.name}@${packageJson.version}
- 源码目录：${skill.source}
- 项目主页：${skill.homepage}

## 自动发布目标

| 平台 | 自动化状态 | 命令 |
|---|---|---|
| ClawHub | 支持 CI token 与 dry-run | \`clawhub skill publish ${args.skillDir} --slug skill-navigator --name skill-navigator\` |
| skills-hub.ai | 支持 API key 登录；dry-run 时创建草稿 | \`skills-hub publish ${args.skillDir}/SKILL.md --visibility public\` |

## 半自动目标

| 平台 | 处理方式 |
|---|---|
| claudeskills.info | 首次提交 GitHub source URL，后续依赖平台索引 GitHub。 |
| mcpservers.org Agent Skills | 首次提交 GitHub source URL，后续依赖平台索引或后台编辑。 |
| SkillHub 国内平台 | 当前需确认对应 registry 与 token 来源后再接入。 |
| CowAgent Skill Hub | 使用本目录中的 skill 文件夹或 zip 包人工上传。 |
| awesome-claude-skills / awesome-openclaw-skills | 自动生成 PR 文案，实际 PR 需按对方仓库规范提交。 |

## 发布前检查

- 已运行发布包结构校验。
- 未在发布文件中发现常见密钥格式。
- GitHub 主仓仍是唯一真源。
`;
  fs.writeFileSync(path.join(outputDir, 'release-summary.md'), summary);

  const prLine = '- [skill-navigator](https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator) - Bridge skill for Claude Code and Codex that recommends which already-installed local Agent Skill should handle a user task by querying the local `skm` catalog.\n';
  fs.writeFileSync(path.join(outputDir, 'awesome-pr-entry.md'), prLine);

  let archive = null;
  if (args.archive) archive = makeArchive(outputDir, skill.name);

  const result = {
    ok: true,
    skill: skill.name,
    version: skill.version,
    outputDir,
    stagedDir,
    archive,
    warnings,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`发布包已生成：${path.relative(root, stagedDir)}`);
    if (archive) console.log(`zip 包已生成：${path.relative(root, archive)}`);
    if (!archive && args.archive) console.log('提示：当前系统未找到 zip 命令，已跳过 zip 包生成。');
    for (const warning of warnings) console.log(`警告：${warning}`);
    console.log(`摘要：${path.relative(root, path.join(outputDir, 'release-summary.md'))}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`错误：${error.message}`);
  process.exit(1);
}
