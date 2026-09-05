import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseFrontmatter, fallbackDescription } from '../frontmatter.js';
import { auditSkillDirectory, auditSkillSecurity } from '../securityAudit.js';
import { isValidSourceUrl } from '../sources.js';
import { buildPackageManifest, installationId } from '../skillPackage.js';

const gitCache = new Map();

// 扫描一个 skills 根目录：每个子目录一个 skill，以 SKILL.md 为准。
// 以 . 或 _ 开头的目录视为已归档/隐藏，跳过但计数。
export function scanSkillDir(baseDir, { tool, scope, source = null, allowRootFiles = false }) {
  const skills = [];
  const warnings = [];
  let archived = 0;
  if (!fs.existsSync(baseDir)) return { skills, warnings, archived };

  for (const ent of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name.startsWith('_')) {
      if (isDir(path.join(baseDir, ent.name))) archived++;
      continue;
    }
    const dir = path.join(baseDir, ent.name);
    if (allowRootFiles && ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
      const skill = scanSkillFile(dir, { tool, scope, source });
      if (skill) skills.push(skill);
      continue;
    }
    // 很多用户用软链把 skill 指向共享库（如 ~/.agents/skills），必须跟随软链
    if (!isDir(dir)) continue;
    const mdPath = path.join(dir, 'SKILL.md');
    let text;
    try {
      text = fs.readFileSync(mdPath, 'utf8');
    } catch {
      warnings.push(`缺少或无法读取 SKILL.md：${dir}`);
      continue;
    }
    const { data, hasFrontmatter } = parseFrontmatter(text);
    if (!hasFrontmatter) warnings.push(`无 frontmatter：${mdPath}`);
    const description = String(data.description || fallbackDescription(text) || '').trim();
    const manifest = buildPackageManifest(dir);
    const skill = {
      tool,
      scope,
      source,
      dirName: ent.name,
      name: String(data.name || ent.name),
      description,
      path: dir,
      realPath: safeRealPath(dir),
      isSymlink: !!safeLstat(dir)?.isSymbolicLink(),
      hasFrontmatter,
      skillMdHash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 12),
      skillMdBytes: Buffer.byteLength(text),
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      packageHash: manifest.hash,
      // 该 skill 常驻上下文的开销 ≈ name + description（正文按需加载）
      descTokens: estimateTokens(`${data.name || ent.name} ${description}`),
      upstream: collectUpstreamMetadata(data, dir),
    };
    skill.id = installationId(skill);
    skill.securityFindings = auditSkillDirectory(dir, skill, text);
    skills.push(skill);
  }
  return { skills, warnings, archived };
}

export function scanSkillFile(file, { tool, scope, source = null } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const { data, hasFrontmatter } = parseFrontmatter(text);
  const fileName = path.basename(file, path.extname(file));
  const dirName = fileName || 'skill';
  const description = String(data.description || fallbackDescription(text) || '').trim();
  const stat = fs.statSync(file);
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
  const packageHash = crypto.createHash('sha256').update(`SKILL.md\0${text}`).digest('hex');
  const skill = {
    tool,
    scope,
    source,
    dirName,
    name: String(data.name || dirName),
    description,
    path: file,
    realPath: safeRealPath(file),
    isSymlink: !!safeLstat(file)?.isSymbolicLink(),
    hasFrontmatter,
    skillMdHash: hash,
    skillMdBytes: Buffer.byteLength(text),
    fileCount: 1,
    totalBytes: stat.size,
    packageHash,
    descTokens: estimateTokens(`${data.name || dirName} ${description}`),
    upstream: collectUpstreamMetadata(data, path.dirname(file)),
  };
  skill.id = installationId(skill);
  skill.securityFindings = auditSkillSecurity(text, skill);
  return skill;
}

function collectUpstreamMetadata(data, dir) {
  const version = cleanMeta(data.version);
  const source = validUrlOrNull(data.source);
  const repository = validUrlOrNull(data.repository || data.repo);
  const homepage = validUrlOrNull(data.homepage);
  const git = inspectGit(dir);
  const urls = uniqueUrls([source, repository, homepage, git?.remote]);
  return {
    version,
    source,
    repository,
    homepage,
    git,
    urls,
    trackable: Boolean(git?.remote || source || repository || homepage),
  };
}

function cleanMeta(value) {
  const text = String(value || '').trim();
  return text || null;
}

function validUrlOrNull(value) {
  const text = cleanMeta(value);
  return text && isValidSourceUrl(text) ? text : null;
}

function uniqueUrls(values) {
  return [...new Set(values.filter((v) => isValidSourceUrl(v)))];
}

function inspectGit(dir) {
  const gitRoot = findGitRoot(safeRealPath(dir));
  if (!gitRoot) return null;
  if (gitCache.has(gitRoot)) return withRelativePath(gitCache.get(gitRoot), gitRoot, dir);

  const head = git(['rev-parse', 'HEAD'], gitRoot);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot);
  const upstreamRef = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], gitRoot);
  const remote = git(['config', '--get', 'remote.origin.url'], gitRoot);
  const result = head ? {
    root: gitRoot,
    head,
    branch: branch && branch !== 'HEAD' ? branch : null,
    upstreamRef: upstreamRef || null,
    remote: remote || null,
  } : null;
  gitCache.set(gitRoot, result);
  return withRelativePath(result, gitRoot, dir);
}

function withRelativePath(git, root, dir) {
  if (!git) return null;
  const relativePath = path.relative(root, safeRealPath(dir)).split(path.sep).join('/');
  return { ...git, relativePath: relativePath || null };
}

function findGitRoot(dir) {
  const home = os.homedir();
  let current = dir;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current || current === home) return null;
    current = parent;
  }
  return null;
}

function git(args, cwd) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 2000, windowsHide: true });
    return r.status === 0 ? r.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory(); // statSync 会跟随软链
  } catch {
    return false; // 断链或不可访问
  }
}

function safeRealPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function safeLstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// 粗略估算 token：CJK 每字约 1 token，其余按 4 字符 1 token
export function estimateTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x3ffff)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}
