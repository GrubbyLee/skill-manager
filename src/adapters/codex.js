import fs from 'node:fs';
import { scanSkillDir } from './common.js';
import { parseTomlSections } from '../toml.js';
import { CODEX_SKILLS_DIR, CODEX_CONFIG_FILE } from '../paths.js';

const TOOL = 'codex';

// 扫描 Codex CLI 的 skill（~/.codex/skills）与 MCP（config.toml 的 [mcp_servers.*]）
export function scanCodex() {
  const { skills, warnings, archived } = scanSkillDir(CODEX_SKILLS_DIR, { tool: TOOL, scope: 'user' });
  const mcpServers = [];

  if (fs.existsSync(CODEX_CONFIG_FILE)) {
    try {
      const sections = parseTomlSections(fs.readFileSync(CODEX_CONFIG_FILE, 'utf8'));
      for (const [section, cfg] of Object.entries(sections)) {
        const parts = section.split('.');
        // 只取 mcp_servers.<name> 一级，跳过 mcp_servers.<name>.env 等子表（env 可能含敏感值）
        if (parts.length !== 2 || parts[0] !== 'mcp_servers') continue;
        mcpServers.push({
          name: parts[1],
          tool: TOOL,
          scope: 'user',
          transport: cfg.type || (cfg.url ? 'http' : 'stdio'),
          command: cfg.command ? [cfg.command, ...(Array.isArray(cfg.args) ? cfg.args : [])].join(' ') : cfg.url || '',
          configFile: CODEX_CONFIG_FILE,
        });
      }
    } catch (e) {
      warnings.push(`解析失败：${CODEX_CONFIG_FILE}（${e.message}）`);
    }
  }

  return { skills, mcpServers, warnings, archived };
}
