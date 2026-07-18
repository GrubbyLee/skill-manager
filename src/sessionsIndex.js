import fs from 'node:fs';
import path from 'node:path';
import { HOME, DATA_DIR } from './paths.js';
import { walkFiles, loadJsonFile, saveJsonFile, DAY_MS } from './utils.js';

const INDEX_PATH = path.join(DATA_DIR, 'session-index.json');
export const CLAUDE_SESSIONS_ROOT = path.join(HOME, '.claude', 'projects');
export const CODEX_SESSIONS_ROOT = path.join(HOME, '.codex', 'sessions');

// 安全底线：该窗口内活跃的会话永不进入删除清单（sessions.js 的提示文案也由此换算）
export const SAFE_WINDOW_MS = DAY_MS;

// 会话文件索引：为每个会话日志解析所属工作区（cwd）。
// 两侧的会话文件头部都带 "cwd" 字段；解析成功的映射不可变、永久缓存；
// 解析失败（如会话刚创建、头部尚未写入 cwd）不入缓存，下次运行重试，workspace 为 null。
export function buildSessionIndex() {
  const cache = loadIndex();
  const sessions = [];
  let dirty = false;
  for (const { root, tool } of [
    { root: CLAUDE_SESSIONS_ROOT, tool: 'claude-code' },
    { root: CODEX_SESSIONS_ROOT, tool: 'codex' },
  ]) {
    for (const f of walkFiles(root)) {
      const cached = cache.files[f.path];
      let workspace;
      // 缓存命中需比对 size+mtime：路径复用（同名文件被替换）时头部 cwd 可能已不同
      if (cached && cached.size === f.size && cached.mtimeMs === f.mtimeMs) {
        workspace = cached.workspace;
      } else {
        workspace = parseCwd(f.path);
        if (workspace !== null) {
          cache.files[f.path] = { tool, workspace, size: f.size, mtimeMs: f.mtimeMs };
          dirty = true;
        }
      }
      sessions.push({ path: f.path, tool, workspace: workspace ?? null, size: f.size, mtimeMs: f.mtimeMs });
    }
  }
  // 已删除文件的索引项直接清掉（使用统计的留存由 usage-cache 的墓碑机制负责）
  const alive = new Set(sessions.map((s) => s.path));
  for (const p of Object.keys(cache.files)) {
    if (!alive.has(p)) {
      delete cache.files[p];
      dirty = true;
    }
  }
  if (dirty) saveJsonFile(INDEX_PATH, cache);
  return sessions;
}

// 清理策略（纯函数，便于测试）：同一工作区内，保留 最近 keep 个 ∪ days 天以内 ∪ 安全窗口内活跃 的会话。
// keep 与 days 至少提供一个；两者并集，宁多留不少留。
export function selectDeletions(files, { keep = null, days = null, nowMs = Date.now() }) {
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = new Set();
  for (const f of sorted) if (nowMs - f.mtimeMs < SAFE_WINDOW_MS) kept.add(f.path);
  if (keep != null) for (const f of sorted.slice(0, keep)) kept.add(f.path);
  if (days != null) for (const f of sorted) if (nowMs - f.mtimeMs <= days * DAY_MS) kept.add(f.path);
  return {
    kept: sorted.filter((f) => kept.has(f.path)),
    toDelete: sorted.filter((f) => !kept.has(f.path)),
  };
}

function parseCwd(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = buf.toString('utf8', 0, n).match(/"cwd":"([^"]+)"/);
    if (m) return m[1];
  } catch {
    /* 读不到按未知处理 */
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 关闭失败无需处理 */
      }
    }
  }
  return null;
}

function loadIndex() {
  const c = loadJsonFile(INDEX_PATH);
  if (c?.version === 1 && c.files) return c;
  return { version: 1, files: {} };
}
