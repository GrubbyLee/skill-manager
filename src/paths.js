import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

// 本工具自身的数据目录（只存扫描产物，不碰任何 AIDE 的配置）
export const DATA_DIR = path.join(HOME, '.skill-manager');
export const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
export const RULES_PATH = path.join(DATA_DIR, 'rules.json');

// 各 AIDE 的扫描目标
export const CLAUDE_SKILLS_DIR = path.join(HOME, '.claude', 'skills');
export const CLAUDE_PLUGINS_FILE = path.join(HOME, '.claude', 'plugins', 'installed_plugins.json');
export const CLAUDE_CONFIG_FILE = path.join(HOME, '.claude.json');
export const CODEX_SKILLS_DIR = path.join(HOME, '.codex', 'skills');
export const CODEX_CONFIG_FILE = path.join(HOME, '.codex', 'config.toml');

// 会话日志根目录（usage 统计与 sessions 索引共用，单一来源）
export const CLAUDE_SESSIONS_ROOT = path.join(HOME, '.claude', 'projects');
export const CODEX_SESSIONS_ROOT = path.join(HOME, '.codex', 'sessions');
