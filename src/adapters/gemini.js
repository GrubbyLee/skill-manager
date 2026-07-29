import fs from 'node:fs';
import path from 'node:path';
import { scanSkillDir } from './common.js';
import { GEMINI_SKILLS_DIRS } from '../paths.js';

const TOOL = 'gemini';

// Gemini CLI 适配器目前只扫描显式存在的 skills 目录。
// 不解析 GEMINI.md 正文，不启动 MCP，也不读取可能包含密钥的配置段。
export function scanGemini({ cwd = process.cwd() } = {}) {
  const skills = [];
  const warnings = [];
  let archived = 0;
  const seen = new Set();
  for (const dir of [...GEMINI_SKILLS_DIRS, path.join(cwd, '.gemini', 'skills')]) {
    const key = path.resolve(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!fs.existsSync(dir)) continue;
    const res = scanSkillDir(dir, { tool: TOOL, scope: scopeOf(dir, cwd) });
    skills.push(...res.skills);
    warnings.push(...res.warnings);
    archived += res.archived;
  }
  return { skills, mcpServers: [], warnings, archived };
}

function scopeOf(dir, cwd) {
  return path.resolve(dir).startsWith(path.resolve(cwd)) ? 'project' : 'user';
}
