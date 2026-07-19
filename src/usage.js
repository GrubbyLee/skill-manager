import path from 'node:path';
import { DATA_DIR, CLAUDE_SESSIONS_ROOT, CODEX_SESSIONS_ROOT } from './paths.js';
import { walkFiles, forEachLine, loadJsonFile, saveJsonFile } from './utils.js';

const CACHE_PATH = path.join(DATA_DIR, 'usage-cache.json');
// v3：内置斜杠命令不计入统计、codex 路径正则锚定；解析规则变更需作废旧缓存全量重扫
const CACHE_VERSION = 3;

// Claude Code 的内置斜杠命令：出现在 <command-name> 里但不是 skill，不应计入使用统计
const BUILTIN_COMMANDS = new Set([
  'clear', 'compact', 'help', 'config', 'cost', 'doctor', 'exit', 'quit', 'login', 'logout',
  'model', 'permissions', 'resume', 'status', 'memory', 'hooks', 'mcp', 'agents', 'export',
  'bug', 'vim', 'terminal-setup', 'install-github-app', 'release-notes', 'migrate-installer',
  'add-dir', 'statusline', 'output-style', 'bashes', 'todos', 'tasks', 'context', 'rewind',
  'upgrade', 'privacy-settings', 'ide', 'fast', 'usage', 'workflows',
]);

// 使用统计：从会话日志里还原每个 skill / MCP 的实际使用情况。
// 日志只增不改，按 文件路径+大小+mtime 增量缓存，首轮全量扫描后续秒级。
//
// 信号来源：
//   Claude Code（~/.claude/projects/**/*.jsonl）：
//     - tool_use 事件 name === "Skill"，input.skill 即 skill 名（精确信号）
//     - <command-name>/xxx</command-name> 斜杠命令调用
//     - tool_use 名称 mcp__<server>__<tool> → MCP server 使用计数
//   Codex（~/.codex/sessions/**/*.jsonl）：
//     - function_call 记录中实际读取 skills/<name>/SKILL.md 才算使用（上下文注入的清单不算），
//       同一会话同一 skill 只计 1 次
export function scanUsage({ log = () => {} } = {}) {
  const cache = loadCache();
  const files = [
    ...walkFiles(CLAUDE_SESSIONS_ROOT).map((f) => ({ ...f, kind: 'claude' })),
    ...walkFiles(CODEX_SESSIONS_ROOT).map((f) => ({ ...f, kind: 'codex' })),
  ];

  let dirty = false;
  let scanned = 0;
  for (const f of files) {
    const cached = cache.files[f.path];
    if (cached && cached.size === f.size && cached.mtimeMs === f.mtimeMs) continue;
    cache.files[f.path] = {
      size: f.size,
      mtimeMs: f.mtimeMs,
      ...(f.kind === 'claude' ? scanClaudeFile(f.path) : scanCodexFile(f.path)),
    };
    dirty = true;
    scanned++;
    if (scanned % 50 === 0) log(`  已扫描 ${scanned} 个新增/变更日志文件…`);
  }

  // 墓碑合并：已删除日志的统计并入 retired 聚合桶——数字永久保留，路径键释放，缓存不随清理膨胀
  const alive = new Set(files.map((f) => f.path));
  for (const [p, f] of Object.entries(cache.files)) {
    if (alive.has(p)) continue;
    mergeCounts(cache.retired.skills, f.skills);
    mergeCounts(cache.retired.mcp, f.mcp);
    if (f.earliest && (!cache.retired.earliest || f.earliest < cache.retired.earliest)) {
      cache.retired.earliest = f.earliest;
    }
    delete cache.files[p];
    dirty = true;
  }

  if (dirty) saveJsonFile(CACHE_PATH, cache);
  return { ...aggregate(cache), scannedFiles: scanned, totalFiles: files.length };
}

function scanClaudeFile(file) {
  const skills = {};
  const mcp = {};
  let earliest = null;
  try {
    forEachLine(file, (line) => {
      // 先用子串过滤避免逐行 JSON.parse
      const hasSkill = line.includes('"Skill"');
      const hasCommand = line.includes('<command-name>');
      const hasMcp = line.includes('"mcp__');
      if (!hasSkill && !hasCommand && !hasMcp) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      const ts = obj.timestamp || null;
      if (ts && (!earliest || ts < earliest)) earliest = ts;
      const content = obj?.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type !== 'tool_use') continue;
          if (c.name === 'Skill' && c.input?.skill) {
            bump(skills, normalizeSkillName(c.input.skill), ts);
          } else if (typeof c.name === 'string' && c.name.startsWith('mcp__')) {
            bump(mcp, mcpServerName(c.name), ts);
          }
        }
      }
      if (hasCommand) {
        const text = extractText(content);
        const m = text.match(/<command-name>\/?([A-Za-z0-9:_-]+)<\/command-name>/);
        if (m) {
          const name = normalizeSkillName(m[1]);
          if (!BUILTIN_COMMANDS.has(name)) bump(skills, name, ts);
        }
      }
    });
  } catch {
    /* 单个文件读取失败不影响整体（下次 mtime 变化会重试） */
  }
  return { skills, mcp, earliest };
}

export function scanCodexFile(file) {
  // 只认 function_call 里实际读取 SKILL.md 的行为；解析层不过滤名称（过滤在消费侧做），
  // 避免"skill 安装晚于日志扫描 → 历史使用被缓存永久抹掉"
  const seen = new Map(); // name -> 最近时间戳
  let earliest = null;
  try {
    forEachLine(file, (line) => {
      if (!line.includes('SKILL.md') || !line.includes('function_call')) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (obj.type !== 'response_item' || obj.payload?.type !== 'function_call') return;
      // 锚定 skills/ 前必须是路径分隔符，避免 myskills/foo 误匹配；支持嵌套 skill 目录（取叶子名）
      const re = /[\\/]skills\/((?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+)\/SKILL\.md/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const name = m[1].split('/').pop();
        const ts = obj.timestamp || null;
        if (ts && (!earliest || ts < earliest)) earliest = ts;
        if (!seen.has(name) || (ts && ts > seen.get(name))) seen.set(name, ts);
      }
    });
  } catch {
    /* 同上 */
  }
  const skills = {};
  for (const [name, ts] of seen) skills[name] = { count: 1, lastUsed: ts };
  return { skills, mcp: {}, earliest };
}

// mcp__<server>__<tool> → server；server 名本身可含双下划线，故从最后一个 __ 切
function mcpServerName(toolName) {
  const rest = toolName.slice('mcp__'.length);
  const cut = rest.lastIndexOf('__');
  return cut > 0 ? rest.slice(0, cut) : rest;
}

// 去掉插件命名空间（superpowers:brainstorming → brainstorming）与目录前缀
function normalizeSkillName(raw) {
  const parts = raw.split(':');
  return parts[parts.length - 1].replace(/^\//, '');
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join(' ');
  return '';
}

function bump(map, name, ts) {
  if (!map[name]) map[name] = { count: 0, lastUsed: null };
  map[name].count++;
  if (ts && (!map[name].lastUsed || ts > map[name].lastUsed)) map[name].lastUsed = ts;
}

function mergeCounts(target, source) {
  for (const [name, v] of Object.entries(source || {})) {
    if (!target[name]) target[name] = { count: 0, lastUsed: null };
    target[name].count += v.count;
    if (v.lastUsed && (!target[name].lastUsed || v.lastUsed > target[name].lastUsed)) {
      target[name].lastUsed = v.lastUsed;
    }
  }
}

function aggregate(cache) {
  const skills = {};
  const mcp = {};
  let earliest = cache.retired.earliest || null;
  mergeCounts(skills, cache.retired.skills);
  mergeCounts(mcp, cache.retired.mcp);
  for (const f of Object.values(cache.files)) {
    mergeCounts(skills, f.skills);
    mergeCounts(mcp, f.mcp);
    if (f.earliest && (!earliest || f.earliest < earliest)) earliest = f.earliest;
  }
  return { skills, mcp, earliest };
}

function loadCache() {
  const c = loadJsonFile(CACHE_PATH);
  if (c?.version === CACHE_VERSION && c.files && c.retired) return c;
  return { version: CACHE_VERSION, files: {}, retired: { skills: {}, mcp: {}, earliest: null } };
}

// 构造 skill → 使用情况 的查询函数（audit 与 status 共用）。
// 调用名可能是 frontmatter name 或目录名；name 键只在不与其他 skill 的目录名冲突时才计入，
// 避免"A 的 name 恰好等于 B 的 dirName"时同一批调用被记到两个 skill 头上
export function buildUsageLookup(merged, usage) {
  const allDirNames = new Set(merged.map((m) => m.dirName));
  return (m) => {
    const a = usage.skills[m.dirName];
    const b = m.name !== m.dirName && !allDirNames.has(m.name) ? usage.skills[m.name] : null;
    return {
      count: (a?.count || 0) + (b?.count || 0),
      lastUsed: [a?.lastUsed, b?.lastUsed].filter(Boolean).sort().pop() || null,
    };
  };
}
