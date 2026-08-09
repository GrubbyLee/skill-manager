import fs from 'node:fs';
import path from 'node:path';
import { scanSkillDir } from './common.js';
import { pushJsonMcpServers } from './mcpConfig.js';
import { WORKBUDDY_SKILLS_DIR, WORKBUDDY_PLUGINS_CACHE, WORKBUDDY_MARKETPLACES_DIR, WORKBUDDY_MCP_FILE } from '../paths.js';

const TOOL = 'workbuddy';

// WorkBuddy 能加载到的 skill 与 MCP：
//   skill：用户级 ~/.workbuddy/skills、项目级 <cwd>/.workbuddy/skills、插件缓存内置技能
//   MCP：~/.workbuddy/mcp.json 的 mcpServers
export function scanWorkBuddy({ cwd = process.cwd() } = {}) {
  const skills = [];
  const mcpServers = [];
  const warnings = [];
  let archived = 0;

  const collect = (res) => {
    skills.push(...res.skills);
    warnings.push(...res.warnings);
    archived += res.archived;
  };

  collect(scanSkillDir(WORKBUDDY_SKILLS_DIR, { tool: TOOL, scope: 'user' }));

  // 项目级技能（<cwd>/.workbuddy/skills）；cwd 为 HOME 时与用户级同路径，跳过以免双份
  const projectSkillsDir = path.join(cwd, '.workbuddy', 'skills');
  if (!isSameDir(projectSkillsDir, WORKBUDDY_SKILLS_DIR)) {
    collect(scanSkillDir(projectSkillsDir, { tool: TOOL, scope: 'project' }));
  }

  // 插件缓存内置技能，两种布局：
  //   cache/{marketplace}/{plugin}/{version}/skills/
  //   marketplaces/{marketplace}/plugins/{plugin}/skills/
  for (const plugin of scanPluginSkillDirs()) {
    collect(
      scanSkillDir(plugin.skillsDir, {
        tool: TOOL,
        scope: 'plugin',
        source: plugin.source,
      }),
    );
  }

  // 全局 MCP（~/.workbuddy/mcp.json）。只读 mcpServers 字段，绝不读取 env 中的敏感值
  const globalConfig = readJson(WORKBUDDY_MCP_FILE, warnings);
  pushJsonMcpServers(mcpServers, globalConfig?.mcpServers, { tool: TOOL, scope: 'user', configFile: WORKBUDDY_MCP_FILE });

  return { skills, mcpServers, warnings, archived };
}

// 遍历插件缓存，找到所有含 skills/ 的插件版本目录
function scanPluginSkillDirs() {
  const found = [];
  const cacheRoot = WORKBUDDY_PLUGINS_CACHE;
  const marketplaceRoot = WORKBUDDY_MARKETPLACES_DIR;

  // 布局一：cache/{marketplace}/{plugin}/{version}/skills/
  for (const marketplace of safeReaddir(cacheRoot)) {
    const mktDir = path.join(cacheRoot, marketplace);
    if (!isDir(mktDir)) continue;
    for (const plugin of safeReaddir(mktDir)) {
      const pluginDir = path.join(mktDir, plugin);
      if (!isDir(pluginDir)) continue;
      for (const version of safeReaddir(pluginDir)) {
        const versionDir = path.join(pluginDir, version);
        if (!isDir(versionDir)) continue;
        const skillsDir = path.join(versionDir, 'skills');
        if (isDir(skillsDir)) {
          found.push({ skillsDir, source: `${marketplace}/${plugin}` });
        }
      }
    }
  }

  // 布局二：marketplaces/{marketplace}/plugins/{plugin}/skills/
  for (const marketplace of safeReaddir(marketplaceRoot)) {
    const mktDir = path.join(marketplaceRoot, marketplace);
    if (!isDir(mktDir)) continue;
    const pluginsDir = path.join(mktDir, 'plugins');
    if (!isDir(pluginsDir)) continue;
    for (const plugin of safeReaddir(pluginsDir)) {
      const pluginDir = path.join(pluginsDir, plugin);
      if (!isDir(pluginDir)) continue;
      const skillsDir = path.join(pluginDir, 'skills');
      if (isDir(skillsDir)) {
        found.push({ skillsDir, source: `${marketplace}/${plugin}` });
      }
    }
  }

  // 去重（两布局可能指向同一插件）
  const seen = new Set();
  return found.filter((f) => {
    const key = path.resolve(f.skillsDir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isSameDir(a, b) {
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
