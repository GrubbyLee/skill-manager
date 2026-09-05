import fs from 'node:fs';
import path from 'node:path';
import { ensureCatalog } from './scan.js';
import { mergeByDirName, isDupEntity } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { CLAUDE_SKILLS_DIR, DATA_DIR } from '../paths.js';
import { confirm, fileStamp, loadJsonFile, paint, saveJsonFile } from '../utils.js';
import { fmtAgoLang, tr } from '../i18n.js';
import { renderTable, termWidth } from '../table.js';

const CLAUDE_MODES = new Set(['on', 'name-only', 'user-invocable-only', 'user-only', 'off']);
const USER_MODE_ALIAS = 'user-only';
const USER_MODE_VALUE = 'user-invocable-only';
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export async function runState(ctx, args = []) {
  const action = args[0] || 'plan';
  if (action === 'plan') return runStatePlan(ctx);
  if (action === 'list') return runStateList(ctx);
  if (action === 'set') return runStateSet(ctx, args.slice(1));
  console.error(tr(ctx.lang, 'state.unknownAction', { action }));
  process.exitCode = 1;
}

export function buildStatePlan({ catalog, usage, lang = 'zh-CN' }) {
  const merged = mergeByDirName(catalog.skills || []);
  const usageOf = buildUsageLookup(merged, usage);
  return merged.map((skill) => {
    const u = usageOf(skill);
    const tools = skill.tools || [skill.tool];
    const duplicate = isDupEntity(skill);
    const stale = isStale(u.lastUsed);
    const highContext = Number(skill.descTokens || 0) >= 120;
    const hasPluginEntry = (skill.entries || [skill]).some((entry) => entry.scope === 'plugin');
    const targetTools = targetToolsFor(skill);
    const rec = recommendState({ skill, usage: u, duplicate, stale, highContext, hasPluginEntry, targetTools, lang });
    return {
      name: skill.dirName,
      tools,
      category: skill.category || '',
      usageCount: u.count,
      lastUsed: u.lastUsed || null,
      descTokens: skill.descTokens || 0,
      duplicate,
      stale,
      highContext,
      targetTools,
      recommendedMode: rec.mode,
      action: rec.action,
      reason: rec.reason,
      command: rec.command,
    };
  }).sort((a, b) => planOrder(a) - planOrder(b) || b.descTokens - a.descTokens || a.name.localeCompare(b.name));
}

function runStatePlan({ cwd, json = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);
  const usage = scanUsage({ log: (msg) => console.error(msg), lang });
  const rows = buildStatePlan({ catalog, usage, lang });
  if (json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), items: rows }, null, 2));
    return;
  }
  console.log(paint.bold(tr(lang, 'state.planTitle')) + '\n');
  console.log(renderTable(
    [
      { title: tr(lang, 'state.col.name'), width: 26 },
      { title: tr(lang, 'state.col.tool'), width: 16 },
      { title: tr(lang, 'state.col.usage'), width: 12 },
      { title: tr(lang, 'state.col.mode'), width: 12 },
      { title: tr(lang, 'state.col.reason'), width: 30 },
      { title: tr(lang, 'state.col.next'), width: 0 },
    ],
    rows.slice(0, 30).map((row) => [
      row.name,
      formatTools(row.targetTools, lang),
      formatUsage(row, lang),
      displayMode(row.recommendedMode),
      row.reason,
      row.command,
    ]),
    Math.min(termWidth(), 120),
  ));
  if (rows.length > 30) console.log(tr(lang, 'state.more', { count: rows.length - 30 }));
  console.log(`\n${tr(lang, 'state.planNote')}`);
}

function runStateList({ cwd, json = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);
  const rows = collectClaudeStates(catalog, cwd, lang);
  if (json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), items: rows }, null, 2));
    return;
  }
  if (!rows.length) {
    console.log(tr(lang, 'state.noClaudeSkills'));
    return;
  }
  console.log(paint.bold(tr(lang, 'state.listTitle')) + '\n');
  console.log(renderTable(
    [
      { title: tr(lang, 'state.col.name'), width: 28 },
      { title: tr(lang, 'state.col.scope'), width: 12 },
      { title: tr(lang, 'state.col.currentMode'), width: 12 },
      { title: tr(lang, 'state.col.source'), width: 0 },
    ],
    rows.map((row) => [row.name, row.scope, displayMode(row.mode), row.source]),
    Math.min(termWidth(), 100),
  ));
}

async function runStateSet(opts, names) {
  const { cwd, tool, mode, scope, yes = false, lang = 'zh-CN' } = opts;
  const name = names[0];
  if (!name || !mode) {
    console.error(tr(lang, 'state.setUsage'));
    process.exitCode = 1;
    return;
  }
  const normalizedMode = normalizeMode(mode);
  if (!normalizedMode) {
    console.error(tr(lang, 'state.modeInvalid', { value: mode }));
    process.exitCode = 1;
    return;
  }
  if (scope && !['user', 'project'].includes(scope)) {
    console.error(tr(lang, 'state.scopeInvalid', { value: scope }));
    process.exitCode = 1;
    return;
  }
  const selectedTool = normalizeTool(tool);
  if (selectedTool === 'pi') {
    console.error(tr(lang, 'state.piManual', { name }));
    process.exitCode = 1;
    return;
  }
  if (selectedTool && selectedTool !== 'claude') {
    printCodexManual({ name, mode: normalizedMode, lang });
    process.exitCode = 1;
    return;
  }

  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(catalog.skills || []);
  const skill = merged.find((item) => item.dirName === name);
  if (!skill) {
    console.error(tr(lang, 'state.skillNotFound', { name }));
    process.exitCode = 1;
    return;
  }
  const claudeEntries = (skill.entries || [skill]).filter((entry) => entry.tool === 'claude-code');
  if (!claudeEntries.length) {
    printCodexManual({ name, mode: normalizedMode, lang });
    process.exitCode = 1;
    return;
  }
  if (claudeEntries.some((entry) => entry.scope === 'plugin')) {
    console.error(tr(lang, 'state.pluginUnsupported', { name }));
    process.exitCode = 1;
    return;
  }

  const target = resolveClaudeSettingsTarget({ cwd, scope, entries: claudeEntries });
  console.log(tr(lang, 'state.setPlan', { name, mode: displayMode(normalizedMode), file: target.file }));
  if (opts.dryRun || opts['dry-run']) {
    console.log(tr(lang, 'state.dryRun'));
    return;
  }
  if (!(await confirm(tr(lang, 'toggle.confirm'), confirmOptions(yes, lang)))) return;

  const fileExists = fs.existsSync(target.file);
  const backup = fileExists ? backupFile(target.file, `claude-settings.${target.scope}`) : null;
  const settings = fileExists ? readJsonStrict(target.file, lang) : {};
  if (!settings) return;
  if (settings.skillOverrides == null) settings.skillOverrides = {};
  if (!isPlainObject(settings.skillOverrides)) {
    console.error(tr(lang, 'state.badOverrides', { file: target.file }));
    process.exitCode = 1;
    return;
  }
  settings.skillOverrides[name] = normalizedMode;
  saveJsonFile(target.file, settings, { pretty: true });
  console.log(tr(lang, 'state.saved', { name, mode: displayMode(normalizedMode), file: target.file, backup: backup || tr(lang, 'common.none') }));
}

export function normalizeMode(mode) {
  const value = String(mode || '').trim();
  if (!CLAUDE_MODES.has(value)) return null;
  return value === USER_MODE_ALIAS ? USER_MODE_VALUE : value;
}

function normalizeTool(tool) {
  if (!tool) return null;
  if (tool === 'claude-code') return 'claude';
  return tool;
}

function collectClaudeStates(catalog, cwd, lang) {
  const merged = mergeByDirName(catalog.skills || []);
  const settings = readClaudeSettings(cwd);
  const project = settings.project.skillOverrides || {};
  const user = settings.user.skillOverrides || {};
  return merged
    .filter((skill) => (skill.entries || [skill]).some((entry) => entry.tool === 'claude-code'))
    .map((skill) => {
      const mode = project[skill.dirName] || user[skill.dirName] || 'on';
      const source = project[skill.dirName]
        ? settings.project.file
        : user[skill.dirName]
          ? settings.user.file
          : tr(lang, 'state.defaultSource');
      const scope = (skill.entries || [skill]).some((entry) => entry.scope === 'project') ? 'project' : 'user';
      return { name: skill.dirName, scope, mode, source };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readClaudeSettings(cwd) {
  const userFile = path.join(path.dirname(CLAUDE_SKILLS_DIR), 'settings.json');
  const projectFile = path.join(cwd, '.claude', 'settings.local.json');
  return {
    user: { file: userFile, ...(loadJsonFile(userFile) || {}) },
    project: { file: projectFile, ...(loadJsonFile(projectFile) || {}) },
  };
}

function resolveClaudeSettingsTarget({ cwd, scope, entries }) {
  const hasProject = entries.some((entry) => entry.scope === 'project');
  const targetScope = scope === 'project' || (!scope && hasProject && !entries.some((entry) => entry.scope === 'user')) ? 'project' : 'user';
  const file = targetScope === 'project'
    ? path.join(cwd, '.claude', 'settings.local.json')
    : path.join(path.dirname(CLAUDE_SKILLS_DIR), 'settings.json');
  return { scope: targetScope, file };
}

function recommendState({ skill, usage, duplicate, stale, highContext, hasPluginEntry, targetTools, lang }) {
  const hasClaude = targetTools.includes('claude');
  const hasCodex = targetTools.includes('codex');
  if (hasPluginEntry) {
    return {
      mode: 'on',
      action: 'manual',
      reason: tr(lang, 'state.reason.plugin'),
      command: tr(lang, 'state.command.plugin'),
    };
  }
  if (usage.count === 0 && duplicate) {
    const mode = 'off';
    return {
      mode,
      action: hasClaude ? 'native' : 'manual',
      reason: tr(lang, 'state.reason.duplicateZombie'),
      command: commandFor({ name: skill.dirName, mode, hasClaude, hasCodex }),
    };
  }
  if (usage.count === 0 && highContext) {
    const mode = USER_MODE_VALUE;
    return {
      mode,
      action: hasClaude ? 'native' : 'manual',
      reason: tr(lang, 'state.reason.zombieHighContext'),
      command: commandFor({ name: skill.dirName, mode, hasClaude, hasCodex }),
    };
  }
  if (usage.count === 0 || stale) {
    const mode = 'name-only';
    return {
      mode,
      action: hasClaude ? 'native' : 'manual',
      reason: usage.count === 0 ? tr(lang, 'state.reason.zombie') : tr(lang, 'state.reason.stale'),
      command: commandFor({ name: skill.dirName, mode, hasClaude, hasCodex }),
    };
  }
  if (highContext) {
    const mode = 'name-only';
    return {
      mode,
      action: hasClaude ? 'native' : 'manual',
      reason: tr(lang, 'state.reason.highContext'),
      command: commandFor({ name: skill.dirName, mode, hasClaude, hasCodex }),
    };
  }
  return {
    mode: 'on',
    action: 'keep',
    reason: tr(lang, 'state.reason.keep'),
    command: tr(lang, 'state.command.none'),
  };
}

function commandFor({ name, mode, hasClaude, hasCodex }) {
  if (hasClaude) return `skm state set ${name} --tool claude --mode ${displayMode(mode)}`;
  if (hasCodex) return 'Codex: /skills -> Enable/Disable Skills';
  return 'skm disable ' + name;
}

function targetToolsFor(skill) {
  const tools = skill.tools || [skill.tool];
  return [...new Set(tools.map((tool) => (tool === 'claude-code' ? 'claude' : tool)))];
}

function formatTools(tools, lang) {
  return tools.join(lang === 'en' ? ', ' : '、');
}

function formatUsage(row, lang) {
  if (!row.usageCount) return lang === 'en' ? 'never' : '从未';
  return `${row.usageCount} / ${fmtAgoLang(lang, row.lastUsed)}`;
}

function displayMode(mode) {
  return mode === USER_MODE_ALIAS ? USER_MODE_VALUE : mode;
}

function isStale(lastUsed) {
  if (!lastUsed) return false;
  const t = Date.parse(lastUsed);
  return Number.isFinite(t) && Date.now() - t > 90 * 86400e3;
}

function planOrder(row) {
  return { off: 0, [USER_MODE_VALUE]: 1, 'name-only': 2, on: 3 }[row.recommendedMode] ?? 9;
}

function printCodexManual({ name, mode, lang }) {
  console.error(tr(lang, 'state.codexManual', { name, mode: displayMode(mode) }));
}

function backupFile(file, label) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const base = path.join(BACKUP_DIR, `${label}.${fileStamp()}`);
  let target = base;
  for (let i = 2; fs.existsSync(target); i++) target = `${base}-${i}`;
  fs.copyFileSync(file, target);
  return target;
}

function readJsonStrict(file, lang) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(tr(lang, 'state.settingsParseFailed', { file, message: e.message }));
    process.exitCode = 1;
    return null;
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function confirmOptions(yes, lang) {
  return {
    yes,
    nonInteractiveMessage: tr(lang, 'common.confirmNonInteractive'),
    cancelMessage: tr(lang, 'common.cancelled'),
  };
}
