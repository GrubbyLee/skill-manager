import fs from 'node:fs';
import path from 'node:path';
import { scanSkillDir } from './common.js';
import { pushJsonMcpServers } from './mcpConfig.js';
import { CURSOR_MCP_FILE, CURSOR_SKILLS_DIRS } from '../paths.js';

const TOOL = 'cursor';

// Cursor 的 skill 生态尚未形成稳定公开目录约定；这里只做保守扫描：
// 发现常见 skills 目录才入库，不读取编辑器缓存、工作区隐私文件或环境变量。
export function scanCursor({ cwd = process.cwd() } = {}) {
  const skills = [];
  const mcpServers = [];
  const warnings = [];
  let archived = 0;
  const seen = new Set();
  for (const dir of [...CURSOR_SKILLS_DIRS, path.join(cwd, '.cursor', 'skills')]) {
    const key = path.resolve(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!fs.existsSync(dir)) continue;
    const res = scanSkillDir(dir, { tool: TOOL, scope: scopeOf(dir, cwd) });
    skills.push(...res.skills);
    warnings.push(...res.warnings);
    archived += res.archived;
  }
  const globalMcp = readJson(CURSOR_MCP_FILE, warnings);
  pushJsonMcpServers(mcpServers, globalMcp?.mcpServers, { tool: TOOL, scope: 'user', configFile: CURSOR_MCP_FILE });

  const projectMcpFile = path.join(cwd, '.cursor', 'mcp.json');
  if (!isSameFile(projectMcpFile, CURSOR_MCP_FILE)) {
    const projectMcp = fs.existsSync(projectMcpFile) ? readJson(projectMcpFile, warnings) : null;
    pushJsonMcpServers(mcpServers, projectMcp?.mcpServers, { tool: TOOL, scope: 'project', configFile: projectMcpFile });
  }

  return { skills, mcpServers, warnings, archived };
}

function scopeOf(dir, cwd) {
  return path.resolve(dir).startsWith(path.resolve(cwd)) ? 'project' : 'user';
}

function isSameFile(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function readJson(file, warnings) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fs.existsSync(file)) warnings.push(`解析失败：${file}（${e.message}）`);
    return null;
  }
}
