import fs from 'node:fs';
import path from 'node:path';
import { scanSkillDir, scanSkillFile } from './common.js';
import { KIMI_AGENTS_SKILLS_DIR, PI_AGENT_HOME, PI_SKILLS_DIR } from '../paths.js';

const TOOL = 'pi';

// Pi coding agent 的技能来源：全局 ~/.pi/agent/skills、共享 ~/.agents/skills、项目 .pi/skills。
// Pi 不提供内置 MCP 配置文件，因此这里只返回空 MCP 清单。
export function scanPi({ cwd = process.cwd() } = {}) {
  const skills = [];
  const warnings = [];
  let archived = 0;
  const seen = new Set();
  const collect = (dir, scope, allowRootFiles = false) => {
    const key = realDirKey(dir);
    if (seen.has(key) || !fs.existsSync(dir)) return;
    seen.add(key);
    const result = scanSkillDir(dir, { tool: TOOL, scope, allowRootFiles });
    skills.push(...result.skills);
    warnings.push(...result.warnings);
    archived += result.archived;
  };

  collect(PI_SKILLS_DIR, 'user', true);
  collect(KIMI_AGENTS_SKILLS_DIR, 'user');
  for (const root of projectRoots(cwd)) {
    collect(path.join(root, '.pi', 'skills'), 'project', true);
    collect(path.join(root, '.agents', 'skills'), 'project');
  }
  collectConfiguredResources(path.join(PI_AGENT_HOME, 'settings.json'), 'user');
  for (const root of projectRoots(cwd)) collectConfiguredResources(path.join(root, '.pi', 'settings.json'), 'project');

  return { skills, mcpServers: [], warnings, archived };

  function collectConfiguredResources(settingsFile, scope) {
    let settings;
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch {
      return;
    }
    collectConfiguredPackages(settings, path.dirname(settingsFile), scope);
    if (!Array.isArray(settings?.skills)) return;
    const base = path.dirname(settingsFile);
    for (const value of settings.skills) {
      if (typeof value !== 'string' || value.startsWith('!')) continue;
      const configured = value.startsWith('~')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', value.slice(1))
        : path.isAbsolute(value) ? value : path.resolve(base, value);
      if (isFile(configured) && configured.toLowerCase().endsWith('.md')) {
        const skill = scanSkillFile(configured, { tool: TOOL, scope });
        if (skill && !seen.has(realDirKey(configured))) {
          seen.add(realDirKey(configured));
          skills.push(skill);
        }
        continue;
      }
      if (!isDir(configured)) continue;
      if (fs.existsSync(path.join(configured, 'SKILL.md'))) {
        // Pi settings may point directly at one skill package instead of a skills root.
        const parent = path.dirname(configured);
        const result = scanSkillDir(parent, { tool: TOOL, scope });
        const target = realDirKey(configured);
        for (const skill of result.skills) {
          if (realDirKey(skill.path) !== target) continue;
          const key = realDirKey(skill.path);
          if (seen.has(key)) continue;
          seen.add(key);
          skills.push(skill);
        }
        warnings.push(...result.warnings.filter((warning) => warning.includes(configured)));
      } else {
        collect(configured, scope, true);
      }
    }
  }

  function collectConfiguredPackages(settings, base, scope) {
    if (!Array.isArray(settings?.packages)) return;
    for (const entry of settings.packages) {
      const source = typeof entry === 'string' ? entry : entry?.source;
      if (typeof source !== 'string') continue;
      const candidates = packageRoots(source, base);
      for (const root of candidates) {
        if (!isDir(root)) continue;
        const manifest = readJson(path.join(root, 'package.json')) || {};
        const selected = typeof entry === 'object' && Array.isArray(entry.skills) ? entry.skills : null;
        const packageSkills = Array.isArray(manifest.pi?.skills) ? manifest.pi.skills : [];
        const paths = packageSkills.length ? packageSkills : ['skills'];
        for (const relative of paths) {
          if (typeof relative !== 'string') continue;
          if (selected && selected.length && !selected.includes(relative) && !selected.includes(path.basename(relative))) continue;
          let target = path.resolve(root, relative);
          if (!isFile(target) && !isDir(target)) target = path.resolve(root, 'skills', relative);
          if (isFile(target) && target.toLowerCase().endsWith('.md')) {
            const skill = scanSkillFile(target, { tool: TOOL, scope });
            if (skill && !seen.has(realDirKey(target))) {
              seen.add(realDirKey(target));
              skills.push(skill);
            }
          } else if (isDir(target)) {
            collect(target, scope, true);
          }
        }
        break;
      }
    }
  }
}

function realDirKey(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function projectRoots(cwd) {
  const roots = [];
  let current = path.resolve(cwd);
  while (true) {
    roots.push(current);
    if (isDir(path.join(current, '.git')) || isFile(path.join(current, '.git'))) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots.reverse();
}

function isDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function packageRoots(source, base) {
  const value = source.replace(/^npm:/, '');
  if (value.startsWith('.') || value.startsWith('/') || value.startsWith('~')) {
    const expanded = value.startsWith('~')
      ? path.join(process.env.HOME || process.env.USERPROFILE || '', value.slice(1))
      : path.resolve(base, value);
    return [expanded];
  }
  const npmRoot = path.join(base, 'npm');
  return [path.join(npmRoot, value), path.join(npmRoot, 'node_modules', ...value.split('/'))];
}
