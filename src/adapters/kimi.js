import fs from 'node:fs';
import path from 'node:path';
import { scanSkillDir } from './common.js';
import { pushJsonMcpServers } from './mcpConfig.js';
import { KIMI_SKILLS_DIR, KIMI_CODE_SKILLS_DIR, KIMI_CODE_MCP_FILE, KIMI_DESKTOP_SKILLS_DIRS_CANDIDATES } from '../paths.js';

const TOOL = 'kimi';

// Kimi 的 skill 目录约定（官方文档）：
//   Kimi CLI：   用户级 ~/.kimi/skills；项目级 <cwd>/.kimi/skills
//   Kimi Code：  用户级 $KIMI_CODE_HOME/skills（默认 ~/.kimi-code/skills）；项目级 <cwd>/.kimi-code/skills
//   Kimi Desktop：Windows 版 %APPDATA%/kimi-desktop/daimon-share/daimon/skills（daimon 运行时）
//   MCP：        $KIMI_CODE_HOME/mcp.json（用户级）；项目级 <cwd>/.kimi-code/mcp.json
// 注：Kimi 会回退读取 ~/.claude/skills、~/.codex/skills 与 ~/.agents/skills，
// 但这些目录已被对应适配器或共享目录覆盖，此处只扫 Kimi 自有目录以免重复入库。
export function scanKimi({ cwd = process.cwd() } = {}) {
  const skills = [];
  const mcpServers = [];
  const warnings = [];
  let archived = 0;
  const seen = new Set();

  const collectDir = (dir, scope) => {
    const key = path.resolve(dir);
    if (seen.has(key)) return;
    seen.add(key);
    if (!fs.existsSync(dir)) return;
    const res = scanSkillDir(dir, { tool: TOOL, scope });
    skills.push(...res.skills);
    warnings.push(...res.warnings);
    archived += res.archived;
  };

  // 用户级：Kimi CLI + Kimi Code + Kimi Desktop（daimon，跨平台候选）三套品牌目录
  collectDir(KIMI_SKILLS_DIR, 'user');
  collectDir(KIMI_CODE_SKILLS_DIR, 'user');
  for (const dir of KIMI_DESKTOP_SKILLS_DIRS_CANDIDATES) collectDir(dir, 'user');

  // 项目级：.kimi/skills + .kimi-code/skills
  collectDir(path.join(cwd, '.kimi', 'skills'), 'project');
  collectDir(path.join(cwd, '.kimi-code', 'skills'), 'project');

  // 用户级 MCP（$KIMI_CODE_HOME/mcp.json）
  const globalConfig = readJson(KIMI_CODE_MCP_FILE, warnings);
  pushJsonMcpServers(mcpServers, globalConfig?.mcpServers, { tool: TOOL, scope: 'user', configFile: KIMI_CODE_MCP_FILE });

  // 项目级 MCP（<cwd>/.kimi-code/mcp.json）
  const projectMcpFile = path.join(cwd, '.kimi-code', 'mcp.json');
  if (!isSameFile(projectMcpFile, KIMI_CODE_MCP_FILE)) {
    const projectMcp = fs.existsSync(projectMcpFile) ? readJson(projectMcpFile, warnings) : null;
    pushJsonMcpServers(mcpServers, projectMcp?.mcpServers, { tool: TOOL, scope: 'project', configFile: projectMcpFile });
  }

  return { skills, mcpServers, warnings, archived };
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
