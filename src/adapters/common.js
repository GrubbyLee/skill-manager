import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFrontmatter, fallbackDescription } from '../frontmatter.js';

// 扫描一个 skills 根目录：每个子目录一个 skill，以 SKILL.md 为准。
// 以 . 或 _ 开头的目录视为已归档/隐藏，跳过但计数。
export function scanSkillDir(baseDir, { tool, scope, source = null }) {
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
    const stats = dirStats(dir);
    skills.push({
      id: `${tool}:${scope}:${ent.name}`,
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
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
      // 该 skill 常驻上下文的开销 ≈ name + description（正文按需加载）
      descTokens: estimateTokens(`${data.name || ent.name} ${description}`),
    });
  }
  return { skills, warnings, archived };
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

// 目录统计：共享预算对象贯穿整棵递归树，超限即全树短路（避免软链进大仓库时上万次 stat）
function dirStats(dir, depth = 0, budget = { remaining: 5000 }) {
  let fileCount = 0;
  let totalBytes = 0;
  if (depth > 6) return { fileCount, totalBytes };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { fileCount, totalBytes };
  }
  for (const ent of entries) {
    if (budget.remaining <= 0) break;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const sub = dirStats(p, depth + 1, budget);
      fileCount += sub.fileCount;
      totalBytes += sub.totalBytes;
    } else if (ent.isFile()) {
      budget.remaining--;
      fileCount++;
      try {
        totalBytes += fs.statSync(p).size;
      } catch {
        /* 忽略统计失败的文件 */
      }
    }
  }
  return { fileCount, totalBytes };
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
