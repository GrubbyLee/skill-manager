import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureCatalog, runScan } from './scan.js';
import { mergeByDirName, isDupEntity } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { auditSkillSecurity, summarizeFindings } from '../securityAudit.js';
import { parseFrontmatter, fallbackDescription } from '../frontmatter.js';
import { estimateTokens } from '../adapters/common.js';
import { applySourcesToSkills, upsertSource, isValidSourceUrl } from '../sources.js';
import { CLAUDE_SKILLS_DIR, CODEX_SKILLS_DIR, CURSOR_SKILLS_DIRS, GEMINI_SKILLS_DIRS, WORKBUDDY_SKILLS_DIR, KIMI_SKILLS_DIR, KIMI_CODE_SKILLS_DIR, KIMI_DESKTOP_SKILLS_DIR, DATA_DIR, LOCK_PATH, LIFECYCLE_HISTORY_PATH, POLICY_PATH, PROFILES_PATH, SKILL_BACKUP_DIR } from '../paths.js';
import { confirm, fileStamp, loadJsonFile, paint, saveJsonFile } from '../utils.js';
import { renderTable, termWidth } from '../table.js';

const DEFAULT_PROFILE_MODES = ['on', 'name-only', 'user-invocable-only', 'off'];
const FETCH_TIMEOUT_MS = 8000;

export async function runSkillInstall(ctx, args = []) {
  const source = args[0] || ctx.source;
  const lang = ctx.lang || 'zh-CN';
  if (!source) return fail(lang, zh(lang, '用法：skm install <本地目录|SKILL.md URL|GitHub/Gitee skill 目录 URL> [--tool claude|codex|cursor|gemini|workbuddy|kimi] [--dry-run] [--yes]', 'Usage: skm install <local-dir|SKILL.md URL|GitHub/Gitee skill directory URL> [--tool claude|codex|cursor|gemini|workbuddy|kimi] [--dry-run] [--yes]'));

  const payload = await loadInstallPayload(source, lang);
  if (!payload) return;
  const targets = targetRoots(ctx.tool, ctx.cwd);
  const rows = targets.map((target) => ({ ...target, dir: path.join(target.root, payload.dirName), exists: fs.existsSync(path.join(target.root, payload.dirName)) }));
  printPlan(lang, zh(lang, 'skill 安装计划', 'Skill install plan'), rows.map((row) => [row.label, row.dir, row.exists ? zh(lang, '已存在', 'exists') : zh(lang, '可安装', 'ready')]));
  printSecurity(lang, payload);
  if (isDryRun(ctx)) return console.log(zh(lang, '[dry-run] 未写入 skill 目录。', '[dry-run] no skill directory written.'));
  if (rows.some((row) => row.exists)) return fail(lang, zh(lang, '目标目录已存在；请先处理重复项，或换一个 skill 名称。', 'Target directory already exists; resolve duplicates or use a different skill name.'));
  if (!(await confirm(zh(lang, '确认安装以上 skill？输入 yes 继续：', 'Install the skill above? Type yes to continue: '), confirmOptions(ctx.yes, lang)))) return;
  if (!ensureDataWritable(lang)) return;

  for (const row of rows) copyPayload(payload, row.dir);
  const sourceResult = recordInstallSource(payload.dirName, payload.sourceRecord);
  printIgnoredSourceFields(lang, payload.sourceRecord);
  if (!sourceResult.hasUrl) console.log(zh(lang, `提示：${payload.dirName} 缺少可升级来源。建议运行：skm sources add ${payload.dirName} --source <GitHub/Gitee skill目录或SKILL.md URL>`, `Tip: ${payload.dirName} has no upgrade source. Run: skm sources add ${payload.dirName} --source <GitHub/Gitee skill directory or SKILL.md URL>`));
  appendHistory({ type: 'install', skill: payload.dirName, source: sourceResult.source || source, tools: targets.map((target) => target.tool), targets: rows.map((row) => row.dir), sourceSaved: sourceResult.saved });
  refreshCatalogAfterInstall(ctx, lang);
  console.log(paint.green(zh(lang, `安装完成：${payload.dirName}`, `Installed: ${payload.dirName}`)));
}

export async function runSkillUpdate(ctx, args = []) {
  const name = args[0];
  const lang = ctx.lang || 'zh-CN';
  if (!name) return fail(lang, zh(lang, '用法：skm update <skill名> [--tool claude|codex|cursor|gemini|workbuddy|kimi] [--dry-run] [--yes]', 'Usage: skm update <skill-name> [--tool claude|codex|cursor|gemini|workbuddy|kimi] [--dry-run] [--yes]'));
  const { skill, entries } = findSkillEntriesWithRefresh(ctx, name);
  if (!skill) return fail(lang, zh(lang, `目录中未找到 skill：${name}`, `Skill not found in catalog: ${name}`));
  const selected = selectEntry(entries, ctx.tool);
  if (!selected) return fail(lang, zh(lang, `未找到匹配工具的安装记录：${name}`, `No install record matched the requested tool: ${name}`));
  const source = selected.upstream?.source || selected.upstream?.repository || selected.upstream?.homepage;
  if (!source) return fail(lang, zh(lang, '该 skill 缺少可更新的 source/repository/homepage；先用 skm sources add 补充。', 'This skill lacks source/repository/homepage metadata; add it with skm sources add first.'));
  const payload = await loadInstallPayload(source, lang, selected.dirName);
  if (!payload) return;
  const targetDir = selected.path;
  printPlan(lang, zh(lang, 'skill 更新计划', 'Skill update plan'), [[selected.tool, targetDir, payload.hash === selected.skillMdHash ? zh(lang, '内容一致', 'same content') : zh(lang, '可更新', 'updateable')]]);
  printSecurity(lang, payload);
  if (isDryRun(ctx)) return console.log(zh(lang, '[dry-run] 未更新 skill。', '[dry-run] no skill updated.'));
  if (!(await confirm(zh(lang, '确认备份并更新该 skill？输入 yes 继续：', 'Back up and update this skill? Type yes to continue: '), confirmOptions(ctx.yes, lang)))) return;

  const backup = backupSkillDir(targetDir, selected.dirName);
  replacePayload(payload, targetDir);
  appendHistory({ type: 'update', skill: selected.dirName, tool: selected.tool, source, target: targetDir, backup, oldHash: selected.skillMdHash, newHash: payload.hash });
  console.log(paint.green(zh(lang, `更新完成：${selected.dirName}（备份：${backup}）`, `Updated: ${selected.dirName} (backup: ${backup})`)));
}

export async function runSkillRollback(ctx, args = []) {
  const name = args[0];
  const lang = ctx.lang || 'zh-CN';
  if (!name) return fail(lang, zh(lang, '用法：skm rollback <skill名> [--tool claude|codex|cursor|gemini|workbuddy|kimi] [--dry-run] [--yes]', 'Usage: skm rollback <skill-name> [--tool claude|codex|cursor|gemini|workbuddy|kimi] [--dry-run] [--yes]'));
  const { entries } = findSkillEntries(ctx, name);
  const selected = selectEntry(entries, ctx.tool);
  if (!selected) return fail(lang, zh(lang, `目录中未找到 skill：${name}`, `Skill not found in catalog: ${name}`));
  const backup = latestBackup(selected.dirName);
  if (!backup) return fail(lang, zh(lang, `没有可回滚备份：${selected.dirName}`, `No rollback backup found: ${selected.dirName}`));
  console.log(zh(lang, `将把 ${selected.path} 回滚到 ${backup}`, `Rollback ${selected.path} from ${backup}`));
  if (isDryRun(ctx)) return console.log(zh(lang, '[dry-run] 未执行回滚。', '[dry-run] rollback not executed.'));
  if (!(await confirm(zh(lang, '确认回滚？输入 yes 继续：', 'Rollback now? Type yes to continue: '), confirmOptions(ctx.yes, lang)))) return;
  const currentBackup = backupSkillDir(selected.path, `${selected.dirName}-before-rollback`);
  replaceDir(backup, selected.path);
  appendHistory({ type: 'rollback', skill: selected.dirName, tool: selected.tool, target: selected.path, restoredFrom: backup, backupBeforeRollback: currentBackup });
  console.log(paint.green(zh(lang, `回滚完成：${selected.dirName}`, `Rolled back: ${selected.dirName}`)));
}

export function runSkillLock(ctx, args = []) {
  const lang = ctx.lang || 'zh-CN';
  const action = args[0];
  if (action === 'diff') return runLockDiff(ctx, args[1], false);
  if (action === 'verify') return runLockDiff(ctx, args[1], true);
  if (action && action !== 'write') return fail(lang, zh(lang, `未知 lock 子命令：${action}`, `Unknown lock subcommand: ${action}`));
  const data = buildCurrentLock(ctx, { refresh: true });
  if (ctx.json) return console.log(JSON.stringify(data, null, 2));
  saveJsonFile(LOCK_PATH, data, { pretty: true });
  console.log(paint.green(zh(lang, `锁定文件已写入：${LOCK_PATH}（${data.items.length} 个 skill）`, `Lock file written: ${LOCK_PATH} (${data.items.length} skills)`)));
  appendHistory({ type: 'lock', count: data.items.length, file: LOCK_PATH });
}

function runLockDiff(ctx, fileArg, verifyOnly) {
  const lang = ctx.lang || 'zh-CN';
  const baselineFile = resolveLockPath(fileArg);
  const { data: baseline, error } = loadLockFile(baselineFile, lang);
  if (!baseline) return fail(lang, error || zh(lang, `无法读取锁定文件：${baselineFile}。请先运行 skm lock 建立基线。`, `Unable to read lock file: ${baselineFile}. Run skm lock first to establish a baseline.`));
  const current = buildCurrentLock(ctx, { refresh: true });
  const report = compareLocks(baseline, current, baselineFile);
  if (ctx.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printLockDiff(lang, report, verifyOnly);
  }
  if (verifyOnly && !report.summary.verified) process.exitCode = 1;
}

export function runPolicy(ctx, args = []) {
  const action = args[0] || 'check';
  const lang = ctx.lang || 'zh-CN';
  if (action === 'init') {
    if (fs.existsSync(POLICY_PATH) && !ctx.yes) return fail(lang, zh(lang, `策略文件已存在：${POLICY_PATH}；如需覆盖请加 --yes。`, `Policy file already exists: ${POLICY_PATH}; add --yes to overwrite.`));
    saveJsonFile(POLICY_PATH, defaultPolicy(), { pretty: true });
    appendHistory({ type: 'policy-init', file: POLICY_PATH });
    return console.log(paint.green(zh(lang, `策略文件已写入：${POLICY_PATH}`, `Policy file written: ${POLICY_PATH}`)));
  }
  if (action !== 'check') return fail(lang, zh(lang, `未知 policy 子命令：${action}`, `Unknown policy subcommand: ${action}`));
  const report = collectPolicyReport(ctx);
  if (ctx.json) {
    console.log(JSON.stringify(report, null, 2));
    if (report.failed) process.exitCode = 1;
    return;
  }
  printPlan(lang, zh(lang, '策略检查', 'Policy check'), report.items.map((item) => [item.status, item.rule, item.detail]));
  if (report.failed) process.exitCode = 1;
}

export async function runProfile(ctx, args = []) {
  const action = args[0] || 'list';
  const lang = ctx.lang || 'zh-CN';
  if (action === 'list') return printProfiles(ctx);
  if (action === 'create') return createProfile(ctx, args[1]);
  if (action === 'apply') return applyProfile(ctx, args[1]);
  return fail(lang, zh(lang, `未知 profile 子命令：${action}`, `Unknown profile subcommand: ${action}`));
}

export function runSkillEval(ctx, args = []) {
  const lang = ctx.lang || 'zh-CN';
  const name = args[0];
  const catalog = ensureCatalog(ctx.cwd, lang);
  const merged = mergeByDirName(catalog.skills || []);
  const usage = scanUsage({ log: (msg) => console.error(msg), lang });
  const usageOf = buildUsageLookup(merged, usage);
  const rows = merged
    .filter((skill) => ctx.all || !name || skill.dirName === name)
    .map((skill) => evalSkill(skill, usageOf(skill), lang))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  if (name && !rows.length) return fail(lang, zh(lang, `目录中未找到 skill：${name}`, `Skill not found in catalog: ${name}`));
  if (ctx.json) return console.log(JSON.stringify({ generatedAt: new Date().toISOString(), items: rows }, null, 2));
  printPlan(lang, zh(lang, 'skill 质量评测', 'Skill quality evaluation'), rows.slice(0, ctx.all ? 50 : 20).map((row) => [row.name, `${row.score}/100`, row.grade, row.issues.join(lang === 'en' ? '; ' : '；') || zh(lang, '无明显问题', 'No obvious issue')]));
}

export function runSkillHistory(ctx, args = []) {
  const lang = ctx.lang || 'zh-CN';
  const name = args[0];
  const events = loadHistory().events.filter((event) => !name || event.skill === name);
  if (ctx.json) return console.log(JSON.stringify({ events }, null, 2));
  if (!events.length) return console.log(zh(lang, '没有生命周期历史记录。', 'No lifecycle history events.'));
  printPlan(lang, zh(lang, '生命周期历史', 'Lifecycle history'), events.slice(-80).map((event) => [event.time, event.type, event.skill || '—', eventSummary(event, lang)]));
}

function findSkillEntries(ctx, name) {
  const catalog = ensureCatalog(ctx.cwd, ctx.lang);
  const merged = mergeByDirName(applySourcesToSkills(catalog.skills || []));
  const skill = merged.find((item) => item.dirName === name || item.name === name);
  return { skill, entries: skill?.entries || [] };
}

function findSkillEntriesWithRefresh(ctx, name) {
  let result = findSkillEntries(ctx, name);
  if (result.skill) return result;
  runScan({ cwd: ctx.cwd, silent: true, lang: ctx.lang });
  result = findSkillEntries(ctx, name);
  return result;
}

function selectEntry(entries = [], tool) {
  const normalized = normalizeTool(tool);
  const filtered = normalized ? entries.filter((entry) => normalizeTool(entry.tool) === normalized) : entries;
  return filtered.find((entry) => entry.scope === 'user') || filtered[0] || null;
}

async function loadInstallPayload(source, lang, forcedName = null) {
  let text;
  let dirName;
  let sourceDir = null;
  if (isLocalPath(source)) {
    sourceDir = path.resolve(source);
    const md = path.join(sourceDir, 'SKILL.md');
    try {
      text = fs.readFileSync(md, 'utf8');
    } catch (e) {
      fail(lang, zh(lang, `无法读取 SKILL.md：${md}（${e.message}）`, `Unable to read SKILL.md: ${md} (${e.message})`));
      return null;
    }
  } else {
    const url = rawSkillMdUrl(source);
    if (!url) {
      fail(lang, zh(lang, '暂只支持本地 skill 目录、SKILL.md URL、GitHub/Gitee skill 目录 URL。', 'Only local skill directories, SKILL.md URLs, and GitHub/Gitee skill directory URLs are supported for now.'));
      return null;
    }
    text = await fetchText(url);
  }
  const { data, hasFrontmatter } = parseFrontmatter(text);
  dirName = sanitizeName(forcedName || data.name || basenameFromSource(source));
  const description = String(data.description || fallbackDescription(text) || '').trim();
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
  const skill = { dirName, name: data.name || dirName, description, hasFrontmatter, skillMdHash: hash, skillMdBytes: Buffer.byteLength(text), descTokens: estimateTokens(`${data.name || dirName} ${description}`) };
  const findings = auditSkillSecurity(text, skill);
  return { dirName, text, sourceDir, skill, findings, hash, sourceRecord: installSourceRecord(data, source) };
}

async function fetchText(url) {
  if (/^file:\/\//i.test(url)) return fs.readFileSync(new URL(url), 'utf8');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'aide-skill-manager' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function copyPayload(payload, targetDir) {
  if (payload.sourceDir) copyDir(payload.sourceDir, targetDir);
  else {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), payload.text);
  }
}

function replacePayload(payload, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  copyPayload(payload, targetDir);
}

function targetRoots(tool, cwd) {
  const normalized = normalizeTool(tool);
  const all = [
    { tool: 'claude-code', label: 'claude/user', root: CLAUDE_SKILLS_DIR },
    { tool: 'codex', label: 'codex/user', root: CODEX_SKILLS_DIR },
    { tool: 'cursor', label: 'cursor/user', root: CURSOR_SKILLS_DIRS[0] },
    { tool: 'gemini', label: 'gemini/user', root: GEMINI_SKILLS_DIRS[0] },
    { tool: 'workbuddy', label: 'workbuddy/user', root: WORKBUDDY_SKILLS_DIR },
    { tool: 'kimi', label: 'kimi/cli', root: KIMI_SKILLS_DIR },
    { tool: 'kimi-code', label: 'kimi/code', root: KIMI_CODE_SKILLS_DIR },
    { tool: 'kimi-desktop', label: 'kimi/desktop', root: KIMI_DESKTOP_SKILLS_DIR },
  ];
  if (tool === 'kimi') return all.filter((item) => item.tool === 'kimi' || item.tool === 'kimi-code' || item.tool === 'kimi-desktop');
  if (normalized) return all.filter((item) => normalizeTool(item.tool) === normalized);
  return all.filter((item) => ['claude-code', 'codex'].includes(item.tool));
}

function lockRow(skill) {
  const upstream = skill.upstream || {};
  return {
    key: '',
    name: skill.dirName,
    title: skill.name || skill.dirName,
    tool: skill.tool || null,
    scope: skill.scope || null,
    tools: skill.tool ? [skill.tool] : [],
    locationHash: hashText(skill.realPath || skill.path || `${skill.tool || ''}:${skill.scope || ''}:${skill.dirName || ''}`).slice(0, 12),
    version: upstream.version || null,
    source: upstream.source || upstream.repository || upstream.homepage || upstream.git?.remote || null,
    gitHead: upstream.git?.head || null,
    skillMdHash: skill.skillMdHash || null,
    lockedAt: new Date().toISOString(),
  };
}

function buildCurrentLock(ctx, { refresh }) {
  const lang = ctx.lang || 'zh-CN';
  if (refresh) runScan({ cwd: ctx.cwd, silent: true, quiet: true, lang });
  const catalog = ensureCatalog(ctx.cwd, lang);
  const rows = applySourcesToSkills(catalog.skills || []).map((skill) => lockRow(skill));
  const items = assignLockKeys(rows).sort(compareLockItems);
  return { version: 2, generatedAt: new Date().toISOString(), items };
}

function loadLockFile(file, lang) {
  const data = loadJsonFile(file);
  if (!data) return { data: null };
  if (![1, 2].includes(data.version) || !Array.isArray(data.items)) {
    return { data: null, error: zh(lang, `锁定文件格式无效：${file}`, `Invalid lock file format: ${file}`) };
  }
  if (data.version === 1 && data.items.some((item) => !item.key)) {
    return { data: null, error: zh(lang, `锁定文件来自旧版格式，缺少实例级 key。请重新运行 skm lock 建立新基线：${file}`, `The lock file uses an older format without per-installation keys. Re-run skm lock to establish a new baseline: ${file}`) };
  }
  const duplicate = firstDuplicateLockKey(data.items);
  if (duplicate) {
    return { data: null, error: zh(lang, `锁定文件包含重复项：${duplicate}。请重新运行 skm lock 生成干净基线。`, `The lock file contains a duplicate entry: ${duplicate}. Re-run skm lock to generate a clean baseline.`) };
  }
  return { data };
}

function compareLocks(baseline, current, baselineFile) {
  const oldMap = new Map(baseline.items.map((item) => [lockCompareKey(item), normalizeLockItem(item)]));
  const newMap = new Map(current.items.map((item) => [lockCompareKey(item), normalizeLockItem(item)]));
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  for (const [key, item] of newMap) {
    const old = oldMap.get(key);
    if (!old) added.push(item);
    else {
      const fields = changedFields(old, item);
      if (fields.length) changed.push({ key, name: item.name, label: lockLabel(item), fields, before: pickFields(old, fields), after: pickFields(item, fields) });
      else unchanged.push(item);
    }
  }
  for (const [key, item] of oldMap) {
    if (!newMap.has(key)) removed.push(item);
  }
  added.sort(compareLockItems);
  removed.sort(compareLockItems);
  changed.sort(compareLockItems);
  unchanged.sort(compareLockItems);
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    baselineFile,
    baselineGeneratedAt: baseline.generatedAt || null,
    currentGeneratedAt: current.generatedAt || null,
    summary: {
      verified: added.length === 0 && removed.length === 0 && changed.length === 0,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged: unchanged.length,
      baseline: baseline.items.length,
      current: current.items.length,
    },
    added,
    removed,
    changed,
  };
}

function normalizeLockItem(item) {
  return {
    key: lockCompareKey(item),
    name: String(item.name || ''),
    title: item.title || null,
    tool: item.tool || null,
    scope: item.scope || null,
    tools: [...new Set(item.tools || [])].sort(),
    locationHash: item.locationHash || null,
    version: item.version || null,
    source: item.source || null,
    gitHead: item.gitHead || null,
    skillMdHash: item.skillMdHash || null,
  };
}

function changedFields(before, after) {
  return ['title', 'tool', 'scope', 'tools', 'locationHash', 'version', 'source', 'gitHead', 'skillMdHash'].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

function pickFields(item, fields) {
  return Object.fromEntries(fields.map((field) => [field, item[field]]));
}

function printLockDiff(lang, report, verifyOnly) {
  const s = report.summary;
  const title = verifyOnly ? zh(lang, '锁定文件校验', 'Lock verification') : zh(lang, '锁定文件差异', 'Lock diff');
  printPlan(lang, title, [
    [zh(lang, '基线文件', 'Baseline file'), report.baselineFile, report.baselineGeneratedAt || '—'],
    [zh(lang, '当前 skill', 'Current skills'), String(s.current), zh(lang, `基线 ${s.baseline} 个`, `baseline ${s.baseline}`)],
    [zh(lang, '新增', 'Added'), String(s.added), namesOf(report.added)],
    [zh(lang, '删除', 'Removed'), String(s.removed), namesOf(report.removed)],
    [zh(lang, '变更', 'Changed'), String(s.changed), namesOf(report.changed)],
  ]);
  if (s.verified) {
    console.log(paint.green(zh(lang, '锁定文件校验通过：当前 skill 与基线一致。', 'Lock verification passed: current skills match the baseline.')));
  } else if (verifyOnly) {
    console.log(paint.red(zh(lang, '锁定文件校验失败：当前 skill 与基线不一致。', 'Lock verification failed: current skills differ from the baseline.')));
  }
}

function namesOf(items) {
  return items.map((item) => lockLabel(item)).slice(0, 12).join(', ') || '—';
}

function resolveLockPath(fileArg) {
  if (!fileArg) return LOCK_PATH;
  const text = String(fileArg);
  const home = path.dirname(DATA_DIR);
  if (text === '~') return home;
  if (text.startsWith('~/')) return path.join(home, text.slice(2));
  return path.resolve(text);
}

function assignLockKeys(rows) {
  return rows.map((row) => ({ ...row, key: `${lockKeyBase(row)}:${row.locationHash || 'unknown'}` }));
}

function lockKeyBase(item) {
  return [item.tool || 'unknown', item.scope || 'unknown', item.name || 'unknown'].join(':');
}

function lockCompareKey(item) {
  return String(item.key || lockKeyBase(item));
}

function firstDuplicateLockKey(items) {
  const seen = new Set();
  for (const item of items) {
    const key = lockCompareKey(item);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

function compareLockItems(a, b) {
  return lockLabel(a).localeCompare(lockLabel(b)) || lockCompareKey(a).localeCompare(lockCompareKey(b));
}

function lockLabel(item) {
  if (item.label) return item.label;
  const parts = [item.name || 'unknown'];
  const tool = item.tool || (Array.isArray(item.tools) && item.tools.length === 1 ? item.tools[0] : null);
  if (tool || item.scope) parts.push(`(${[tool, item.scope].filter(Boolean).join('/')})`);
  return parts.join(' ');
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function installSourceRecord(data, source) {
  const record = {
    source: validUrlOrNull(data.source),
    repository: validUrlOrNull(data.repository || data.repo),
    homepage: validUrlOrNull(data.homepage),
    version: cleanText(data.version),
  };
  record.ignoredFields = ignoredSourceFields(data);
  if (!record.source && !record.repository && !record.homepage && isValidSourceUrl(source)) record.source = source;
  return record;
}

function recordInstallSource(name, record) {
  const hasUrl = Boolean(record?.source || record?.repository || record?.homepage);
  const hasMetadata = hasUrl || Boolean(record?.version);
  if (!hasMetadata) return { saved: false, hasUrl, source: null };
  upsertSource(name, record);
  return { saved: true, hasUrl, source: record.source || record.repository || record.homepage || null };
}

function ignoredSourceFields(data) {
  const fields = [
    ['source', data.source],
    ['repository', data.repository || data.repo],
    ['homepage', data.homepage],
  ];
  return fields.filter(([, value]) => cleanText(value) && !isValidSourceUrl(cleanText(value))).map(([field]) => field);
}

function printIgnoredSourceFields(lang, record) {
  if (!record?.ignoredFields?.length) return;
  console.log(zh(lang, `提示：已忽略无效来源字段：${record.ignoredFields.join(', ')}。请用 skm sources add 补充有效 URL。`, `Tip: ignored invalid source field(s): ${record.ignoredFields.join(', ')}. Add a valid URL with skm sources add.`));
}

function ensureDataWritable(lang) {
  const probe = path.join(DATA_DIR, `.write-test-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    fail(lang, zh(lang, `无法写入 ~/.skill-manager，已取消安装，避免 skill 已安装但来源记录丢失：${e.message}`, `Unable to write ~/.skill-manager; install cancelled to avoid losing source metadata: ${e.message}`));
    try {
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    } catch {
      /* 忽略探针文件清理失败 */
    }
    return false;
  }
}

function refreshCatalogAfterInstall(ctx, lang) {
  try {
    runScan({ cwd: ctx.cwd, silent: true, lang });
  } catch (e) {
    console.error(zh(lang, `提示：安装已完成，但自动刷新 catalog 失败。请手动运行 skm scan。原因：${e.message}`, `Tip: install succeeded, but automatic catalog refresh failed. Run skm scan manually. Reason: ${e.message}`));
  }
}

function collectPolicyReport(ctx) {
  const lang = ctx.lang || 'zh-CN';
  const policy = loadJsonFile(POLICY_PATH) || defaultPolicy();
  const catalog = ensureCatalog(ctx.cwd, lang);
  const merged = mergeByDirName(applySourcesToSkills(catalog.skills || []));
  const usage = scanUsage({ log: (msg) => console.error(msg), lang });
  const usageOf = buildUsageLookup(merged, usage);
  const neverUsed = merged.filter((skill) => usageOf(skill).count === 0);
  const duplicate = merged.filter(isDupEntity);
  const missingSource = merged.filter((skill) => !(skill.upstream?.source || skill.upstream?.repository || skill.upstream?.homepage || skill.upstream?.git?.remote));
  const highSecurity = (catalog.security?.summary?.high || 0) + (catalog.security?.summary?.medium || 0);
  const items = [
    checkRule('maxSkills', merged.length <= policy.maxSkills, `${merged.length} <= ${policy.maxSkills}`),
    checkRule('maxNeverUsedRate', neverUsed.length / Math.max(1, merged.length) <= policy.maxNeverUsedRate, `${Math.round(neverUsed.length / Math.max(1, merged.length) * 100)}% <= ${Math.round(policy.maxNeverUsedRate * 100)}%`),
    checkRule('maxDuplicateInstalls', duplicate.length <= policy.maxDuplicateInstalls, `${duplicate.length} <= ${policy.maxDuplicateInstalls}`),
    checkRule('requireSource', !policy.requireSource || missingSource.length === 0, policy.requireSource ? `${missingSource.length} missing` : 'disabled'),
    checkRule('blockHighSecurityFindings', !policy.blockHighSecurityFindings || highSecurity === 0, `${highSecurity} high/medium`),
  ];
  return { generatedAt: new Date().toISOString(), policyFile: POLICY_PATH, failed: items.some((item) => item.status === 'fail'), items };
}

function checkRule(rule, pass, detail) {
  return { rule, status: pass ? 'ok' : 'fail', detail };
}

function defaultPolicy() {
  return {
    version: 1,
    maxSkills: 120,
    maxNeverUsedRate: 0.5,
    maxDuplicateInstalls: 20,
    requireSource: false,
    blockHighSecurityFindings: true,
    preferStateBeforeDisable: true,
  };
}

function printProfiles(ctx) {
  const lang = ctx.lang || 'zh-CN';
  const data = loadProfiles();
  const rows = Object.entries(data.profiles).map(([name, profile]) => [name, profile.createdAt || '—', Object.keys(profile.skills || {}).length]);
  if (ctx.json) return console.log(JSON.stringify(data, null, 2));
  if (!rows.length) return console.log(zh(lang, '还没有 profile。可运行 skm profile create <名称>。', 'No profiles yet. Run skm profile create <name>.'));
  printPlan(lang, zh(lang, 'profile 列表', 'Profiles'), rows);
}

function createProfile(ctx, name) {
  const lang = ctx.lang || 'zh-CN';
  if (!name) return fail(lang, zh(lang, '用法：skm profile create <名称>', 'Usage: skm profile create <name>'));
  const catalog = ensureCatalog(ctx.cwd, lang);
  const merged = mergeByDirName(catalog.skills || []);
  const data = loadProfiles();
  if (data.profiles[name] && !ctx.yes) return fail(lang, zh(lang, `profile 已存在：${name}；如需覆盖请加 --yes。`, `Profile already exists: ${name}; add --yes to overwrite.`));
  const currentClaudeModes = readClaudeModes(ctx.cwd);
  const skills = Object.fromEntries(merged.map((skill) => [skill.dirName, currentClaudeModes[skill.dirName] || 'on']));
  if (isDryRun(ctx)) {
    console.log(zh(lang, `[dry-run] 将创建 profile：${name}（${Object.keys(skills).length} 项）。`, `[dry-run] profile to create: ${name} (${Object.keys(skills).length} item(s)).`));
    return;
  }
  data.profiles[name] = { createdAt: new Date().toISOString(), skills };
  saveJsonFile(PROFILES_PATH, data, { pretty: true });
  appendHistory({ type: 'profile-create', profile: name, count: Object.keys(skills).length });
  console.log(paint.green(zh(lang, `profile 已创建：${name}`, `Profile created: ${name}`)));
}

async function applyProfile(ctx, name) {
  const lang = ctx.lang || 'zh-CN';
  if (!name) return fail(lang, zh(lang, '用法：skm profile apply <名称> [--dry-run] [--yes]', 'Usage: skm profile apply <name> [--dry-run] [--yes]'));
  const profile = loadProfiles().profiles[name];
  if (!profile) return fail(lang, zh(lang, `未找到 profile：${name}`, `Profile not found: ${name}`));
  const file = path.join(path.dirname(CLAUDE_SKILLS_DIR), 'settings.json');
  const settings = loadJsonFile(file) || {};
  if (settings.skillOverrides == null) settings.skillOverrides = {};
  if (!isPlainObject(settings.skillOverrides)) return fail(lang, zh(lang, `Claude Code skillOverrides 不是对象，拒绝写入：${file}`, `Claude Code skillOverrides is not an object; refusing to write: ${file}`));
  for (const [skill, mode] of Object.entries(profile.skills || {})) {
    if (DEFAULT_PROFILE_MODES.includes(mode)) settings.skillOverrides[skill] = mode;
  }
  console.log(zh(lang, `将写入 Claude Code skillOverrides：${Object.keys(profile.skills || {}).length} 项`, `Will write Claude Code skillOverrides: ${Object.keys(profile.skills || {}).length} item(s)`));
  if (isDryRun(ctx)) return console.log(zh(lang, '[dry-run] 未应用 profile。', '[dry-run] profile not applied.'));
  if (!(await confirm(zh(lang, '确认应用 profile？输入 yes 继续：', 'Apply profile? Type yes to continue: '), confirmOptions(ctx.yes, lang)))) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = fs.existsSync(file) ? backupFile(file, `claude-settings.profile-${sanitizeName(name)}`) : null;
  saveJsonFile(file, settings, { pretty: true });
  appendHistory({ type: 'profile-apply', profile: name, file, backup });
  console.log(paint.green(zh(lang, `profile 已应用：${name}${backup ? `（备份：${backup}）` : ''}`, `Profile applied: ${name}${backup ? ` (backup: ${backup})` : ''}`)));
}

function evalSkill(skill, usage, lang) {
  let score = 100;
  const issues = [];
  const entries = skill.entries || [skill];
  const security = entries.flatMap((entry) => entry.securityFindings || []);
  const sec = summarizeFindings(security);
  const add = (points, zhText, enText) => {
    score -= points;
    issues.push(zh(lang, zhText, enText));
  };
  if (!skill.description) add(15, '缺少 description', 'missing description');
  if (entries.some((entry) => entry.hasFrontmatter === false)) add(10, '缺少 frontmatter', 'missing frontmatter');
  if (!entries.some((entry) => entry.upstream?.source || entry.upstream?.repository || entry.upstream?.homepage || entry.upstream?.git?.remote)) add(12, '缺少上游来源', 'missing upstream source');
  if (isDupEntity(skill)) add(12, '实体双份安装', 'duplicate physical installs');
  if ((skill.descTokens || 0) > 180) add(8, '上下文开销偏高', 'high context cost');
  if (usage.count === 0) add(8, '从未真实使用', 'never actually used');
  if (sec.high) add(30, '存在高危安全发现', 'high security finding');
  else if (sec.medium) add(15, '存在中危安全发现', 'medium security finding');
  score = Math.max(0, score);
  return { name: skill.dirName, score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D', issues };
}

function loadProfiles() {
  const data = loadJsonFile(PROFILES_PATH);
  if (data?.version === 1 && data.profiles && typeof data.profiles === 'object') return data;
  return { version: 1, profiles: {} };
}

function readClaudeModes(cwd) {
  const userFile = path.join(path.dirname(CLAUDE_SKILLS_DIR), 'settings.json');
  const projectFile = path.join(cwd, '.claude', 'settings.local.json');
  const user = loadJsonFile(userFile)?.skillOverrides || {};
  const project = loadJsonFile(projectFile)?.skillOverrides || {};
  return { ...user, ...project };
}

function loadHistory() {
  const data = loadJsonFile(LIFECYCLE_HISTORY_PATH);
  if (data?.version === 1 && Array.isArray(data.events)) return data;
  return { version: 1, events: [] };
}

function appendHistory(event) {
  const data = loadHistory();
  data.events.push({ time: new Date().toISOString(), ...event });
  saveJsonFile(LIFECYCLE_HISTORY_PATH, data, { pretty: true });
}

function eventSummary(event, lang) {
  if (event.type === 'install') return `${event.tools?.join(', ') || ''} ${event.source || ''}`;
  if (event.type === 'update') return `${event.oldHash || ''} -> ${event.newHash || ''}`;
  if (event.type === 'rollback') return event.restoredFrom || '';
  if (event.type === 'lock') return event.file || '';
  if (event.type?.startsWith('profile')) return event.profile || '';
  return zh(lang, '本地生命周期事件', 'local lifecycle event');
}

function printSecurity(lang, payload) {
  const summary = summarizeFindings(payload.findings);
  console.log(zh(lang, `安全审计：高 ${summary.high || 0} / 中 ${summary.medium || 0} / 低 ${summary.low || 0} / 信息 ${summary.info || 0}`, `Security audit: high ${summary.high || 0} / medium ${summary.medium || 0} / low ${summary.low || 0} / info ${summary.info || 0}`));
}

function printPlan(lang, title, rows) {
  console.log(paint.bold(title) + '\n');
  console.log(renderTable(
    [
      { title: zh(lang, '项目', 'Item'), width: 24 },
      { title: zh(lang, '值', 'Value'), width: 34 },
      { title: zh(lang, '说明', 'Detail'), width: 0 },
    ],
    rows,
    Math.min(termWidth(), 110),
  ));
}

function backupSkillDir(dir, name) {
  const target = path.join(SKILL_BACKUP_DIR, sanitizeName(name), fileStamp());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  copyDir(dir, target);
  return target;
}

function backupFile(file, label) {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `${sanitizeName(label)}.${fileStamp()}.bak`);
  fs.copyFileSync(file, backup);
  return backup;
}

function latestBackup(name) {
  const dir = path.join(SKILL_BACKUP_DIR, sanitizeName(name));
  try {
    return fs.readdirSync(dir).sort().map((item) => path.join(dir, item)).filter((item) => fs.statSync(item).isDirectory()).pop() || null;
  } catch {
    return null;
  }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, ent.name);
    const dst = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(src, dst);
    else if (ent.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (ent.isFile()) fs.copyFileSync(src, dst);
  }
}

function replaceDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  copyDir(from, to);
}

function rawSkillMdUrl(source) {
  if (/^file:\/\//i.test(source) && source.endsWith('/SKILL.md')) return source;
  if (!/^https?:\/\//i.test(source)) return null;
  const u = new URL(source);
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.pathname.endsWith('/SKILL.md')) return source;
  if (u.hostname === 'github.com' && parts.length >= 5 && ['tree', 'blob'].includes(parts[2])) {
    const [owner, repoRaw, , branch, ...rest] = parts;
    return `https://raw.githubusercontent.com/${owner}/${repoRaw.replace(/\.git$/, '')}/${branch}/${[...rest, 'SKILL.md'].join('/')}`;
  }
  if (u.hostname === 'gitee.com' && parts.length >= 5 && ['tree', 'blob'].includes(parts[2])) {
    const [owner, repoRaw, , branch, ...rest] = parts;
    return `https://gitee.com/${owner}/${repoRaw.replace(/\.git$/, '')}/raw/${branch}/${[...rest, 'SKILL.md'].join('/')}`;
  }
  return null;
}

function basenameFromSource(source) {
  const clean = String(source).replace(/[?#].*$/, '').replace(/\/+$/, '');
  return clean.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || 'skill';
}

function isLocalPath(value) {
  return !/^(https?|file):\/\//i.test(String(value || ''));
}

function sanitizeName(name) {
  return String(name || 'skill').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function validUrlOrNull(value) {
  const text = cleanText(value);
  return text && isValidSourceUrl(text) ? text : null;
}

function normalizeTool(tool) {
  if (!tool) return null;
  return tool === 'claude' ? 'claude-code' : tool;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(lang, message) {
  console.error(message);
  process.exitCode = 1;
}

function confirmOptions(yes, lang) {
  return {
    yes,
    nonInteractiveMessage: zh(lang, '非交互环境需加 --yes 确认。', 'Non-interactive environment requires --yes for confirmation.'),
    cancelMessage: zh(lang, '已取消。', 'Cancelled.'),
  };
}

function isDryRun(ctx) {
  return Boolean(ctx.dryRun || ctx['dry-run']);
}

function zh(lang, zhText, enText) {
  return lang === 'en' ? enText : zhText;
}
