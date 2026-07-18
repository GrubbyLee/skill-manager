import fs from 'node:fs';
import path from 'node:path';
import { scanSkillDir } from './common.js';
import { CLAUDE_SKILLS_DIR, CLAUDE_PLUGINS_FILE, CLAUDE_CONFIG_FILE } from '../paths.js';

const TOOL = 'claude-code';

// 扫描 Claude Code 能加载到的 skill 与 MCP：
//   skill：用户级 ~/.claude/skills、项目级 <cwd>/.claude/skills、插件自带 skills
//   MCP：~/.claude.json 的全局 mcpServers、项目根 .mcp.json
export function scanClaudeCode({ cwd }) {
  const skills = [];
  const mcpServers = [];
  const warnings = [];
  let archived = 0;

  const collect = (res) => {
    skills.push(...res.skills);
    warnings.push(...res.warnings);
    archived += res.archived;
  };

  collect(scanSkillDir(CLAUDE_SKILLS_DIR, { tool: TOOL, scope: 'user' }));
  // cwd 为 HOME 时项目级目录与用户级是同一路径，跳过以免同批 skill 双份入库
  const projectSkillsDir = path.join(cwd, '.claude', 'skills');
  if (!isSameDir(projectSkillsDir, CLAUDE_SKILLS_DIR)) {
    collect(scanSkillDir(projectSkillsDir, { tool: TOOL, scope: 'project' }));
  }

  // 插件带来的 skill：从 installed_plugins.json 找到每个插件的安装路径
  for (const plugin of readInstalledPlugins(warnings)) {
    collect(
      scanSkillDir(path.join(plugin.installPath, 'skills'), {
        tool: TOOL,
        scope: 'plugin',
        source: plugin.key,
      }),
    );
  }

  // 全局 MCP（~/.claude.json）。注意：绝不读取/输出 env 中的敏感值
  const globalConfig = readJson(CLAUDE_CONFIG_FILE, warnings);
  pushMcpServers(mcpServers, globalConfig?.mcpServers, 'user', CLAUDE_CONFIG_FILE);

  // 项目级 MCP（<cwd>/.mcp.json）
  const projectMcp = fs.existsSync(path.join(cwd, '.mcp.json'))
    ? readJson(path.join(cwd, '.mcp.json'), warnings)
    : null;
  pushMcpServers(mcpServers, projectMcp?.mcpServers, 'project', path.join(cwd, '.mcp.json'));

  return { skills, mcpServers, warnings, archived };
}

function isSameDir(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function pushMcpServers(list, servers, scope, configFile) {
  if (!servers || typeof servers !== 'object') return;
  for (const [name, cfg] of Object.entries(servers)) {
    list.push({
      name,
      tool: TOOL,
      scope,
      transport: cfg.type || (cfg.url ? 'http' : 'stdio'),
      command: cfg.command ? [cfg.command, ...(cfg.args || [])].join(' ') : cfg.url || '',
      configFile,
    });
  }
}

function readInstalledPlugins(warnings) {
  const data = readJson(CLAUDE_PLUGINS_FILE, warnings);
  if (!data?.plugins) return [];
  const result = [];
  for (const [key, installs] of Object.entries(data.plugins)) {
    for (const inst of Array.isArray(installs) ? installs : []) {
      if (inst.installPath) result.push({ key, installPath: inst.installPath });
    }
  }
  return result;
}

function readJson(file, warnings) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fs.existsSync(file)) warnings.push(`解析失败：${file}（${e.message}）`);
    return null;
  }
}
