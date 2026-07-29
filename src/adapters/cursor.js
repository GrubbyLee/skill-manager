import fs from 'node:fs';
import path from 'node:path';
import { scanSkillDir } from './common.js';
import { CURSOR_SKILLS_DIRS } from '../paths.js';

const TOOL = 'cursor';

// Cursor 的 skill 生态尚未形成稳定公开目录约定；这里只做保守扫描：
// 发现常见 skills 目录才入库，不读取编辑器缓存、工作区隐私文件或环境变量。
export function scanCursor({ cwd = process.cwd() } = {}) {
  const skills = [];
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
  return { skills, mcpServers: [], warnings, archived };
}

function scopeOf(dir, cwd) {
  return path.resolve(dir).startsWith(path.resolve(cwd)) ? 'project' : 'user';
}
