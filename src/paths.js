import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const HOME = os.homedir();

// 本工具自身的数据目录（只存扫描产物，不碰任何 AIDE 的配置）
export const DATA_DIR = path.join(HOME, '.skill-manager');
export const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
export const RULES_PATH = path.join(DATA_DIR, 'rules.json');
export const UPDATE_CACHE_PATH = path.join(DATA_DIR, 'update-cache.json');
export const SOURCES_PATH = path.join(DATA_DIR, 'sources.json');
export const LOCK_PATH = path.join(DATA_DIR, 'skill-lock.json');
export const LIFECYCLE_HISTORY_PATH = path.join(DATA_DIR, 'lifecycle-history.json');
export const POLICY_PATH = path.join(DATA_DIR, 'policy.json');
export const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');
export const SKILL_BACKUP_DIR = path.join(DATA_DIR, 'skill-backups');

// 各 AIDE 的扫描目标
export const CLAUDE_SKILLS_DIR = path.join(HOME, '.claude', 'skills');
export const CLAUDE_PLUGINS_FILE = path.join(HOME, '.claude', 'plugins', 'installed_plugins.json');
export const CLAUDE_CONFIG_FILE = path.join(HOME, '.claude.json');
export const CODEX_SKILLS_DIR = path.join(HOME, '.codex', 'skills');
export const CODEX_CONFIG_FILE = path.join(HOME, '.codex', 'config.toml');
export const CURSOR_SKILLS_DIRS = [
  path.join(HOME, '.cursor', 'skills'),
  path.join(HOME, '.cursor', 'SKILLs'),
];
export const CURSOR_MCP_FILE = path.join(HOME, '.cursor', 'mcp.json');
export const GEMINI_SKILLS_DIRS = [
  path.join(HOME, '.gemini', 'skills'),
  path.join(HOME, '.gemini', 'SKILLs'),
];
export const GEMINI_SETTINGS_FILE = path.join(HOME, '.gemini', 'settings.json');
export const WORKBUDDY_SKILLS_DIR = path.join(HOME, '.workbuddy', 'skills');
export const WORKBUDDY_PLUGINS_CACHE = path.join(HOME, '.workbuddy', 'plugins', 'cache');
export const WORKBUDDY_MARKETPLACES_DIR = path.join(HOME, '.workbuddy', 'plugins', 'marketplaces');
export const WORKBUDDY_MCP_FILE = path.join(HOME, '.workbuddy', 'mcp.json');
// Kimi CLI（~/.kimi）与 Kimi Code CLI（~/.kimi-code，可用 KIMI_CODE_HOME 重定向）
export const KIMI_SKILLS_DIR = path.join(HOME, '.kimi', 'skills');
export const KIMI_CODE_HOME = process.env.KIMI_CODE_HOME || path.join(HOME, '.kimi-code');
export const KIMI_CODE_SKILLS_DIR = path.join(KIMI_CODE_HOME, 'skills');
export const KIMI_CODE_MCP_FILE = path.join(KIMI_CODE_HOME, 'mcp.json');
export const KIMI_AGENTS_SKILLS_DIR = path.join(HOME, '.agents', 'skills');
export const KIMI_DESKTOP_SKILLS_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'kimi-desktop', 'daimon-share', 'daimon', 'skills')
  : process.platform === 'darwin'
    ? path.join(HOME, 'Library', 'Application Support', 'kimi-desktop', 'daimon-share', 'daimon', 'skills')
    : path.join(HOME, '.config', 'kimi-desktop', 'daimon-share', 'daimon', 'skills');
// Kimi Desktop（daimon 运行时）技能目录：按平台候选，目录不存在自动跳过。
// 布局为社区公认约定 {平台数据目录}/kimi-desktop/daimon-share/daimon/skills
export const KIMI_DESKTOP_SKILLS_DIRS = [KIMI_DESKTOP_SKILLS_DIR];
// Pi coding agent：全局 ~/.pi/agent/skills，项目级 <cwd>/.pi/skills。
// Pi 也会读取 ~/.agents/skills；该共享目录由各适配器分别标记可用工具。
export const PI_AGENT_HOME = path.join(HOME, '.pi', 'agent');
export const PI_SKILLS_DIR = path.join(PI_AGENT_HOME, 'skills');
export const PI_SESSIONS_ROOT = path.join(PI_AGENT_HOME, 'sessions');

export function resolvePiSessionRoot(cwd = process.cwd()) {
  const configured = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (configured) return resolvePiPath(configured, cwd);
  let sessionDir = null;
  const globalSettings = readSettings(path.join(PI_AGENT_HOME, 'settings.json'));
  if (typeof globalSettings?.sessionDir === 'string') sessionDir = resolvePiPath(globalSettings.sessionDir, PI_AGENT_HOME);
  for (const root of projectRoots(cwd)) {
    const settings = readSettings(path.join(root, '.pi', 'settings.json'));
    if (typeof settings?.sessionDir === 'string') sessionDir = resolvePiPath(settings.sessionDir, path.join(root, '.pi'));
  }
  return sessionDir || PI_SESSIONS_ROOT;
}

function resolvePiPath(value, base) {
  const text = String(value).trim();
  if (text.startsWith('~')) return path.join(HOME, text.slice(1));
  return path.isAbsolute(text) ? text : path.resolve(base, text);
}

function readSettings(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function projectRoots(cwd) {
  const roots = [];
  let current = path.resolve(cwd);
  while (true) {
    roots.push(current);
    if (fs.existsSync(path.join(current, '.git'))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots.reverse();
}

// 会话日志根目录（usage 统计与 sessions 索引共用，单一来源）
export const CLAUDE_SESSIONS_ROOT = path.join(HOME, '.claude', 'projects');
export const CODEX_SESSIONS_ROOT = path.join(HOME, '.codex', 'sessions');
