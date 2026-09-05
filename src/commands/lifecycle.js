import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureCatalog, runScanLocal } from './scan.js';
import { mergeByDirName, isDupEntity } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { auditSkillDirectory, auditSkillSecurity, localizeSecurityFinding, summarizeFindings } from '../securityAudit.js';
import { parseFrontmatter, fallbackDescription } from '../frontmatter.js';
import { estimateTokens } from '../adapters/common.js';
import { applySourcesToSkills, upsertSource, isValidSourceUrl } from '../sources.js';
import { CLAUDE_SKILLS_DIR, CODEX_SKILLS_DIR, CURSOR_SKILLS_DIRS, GEMINI_SKILLS_DIRS, WORKBUDDY_SKILLS_DIR, KIMI_SKILLS_DIR, KIMI_CODE_SKILLS_DIR, KIMI_DESKTOP_SKILLS_DIR, PI_SKILLS_DIR, DATA_DIR, LOCK_PATH, LIFECYCLE_HISTORY_PATH, POLICY_PATH, PROFILES_PATH, SKILL_BACKUP_DIR } from '../paths.js';
import { confirm, fileStamp, loadJsonFile, paint, saveJsonFile } from '../utils.js';
import { renderTable, termWidth } from '../table.js';
import { buildPackageManifest, diffPackageManifests, installationId } from '../skillPackage.js';
import { acquireSkillSource, atomicReplaceDirectories, atomicReplaceDirectory, prepareCandidate, removePreparedCandidate } from '../skillSource.js';

const DEFAULT_PROFILE_MODES = ['on', 'name-only', 'user-invocable-only', 'off'];
export async function runSkillInstall(ctx, args = []) {
  const source = args[0] || ctx.source;
  const lang = ctx.lang || 'zh-CN';
  if (!source) return fail(lang, zh(lang, '用法：skm install <本地目录|SKILL.md URL|GitHub/Gitee skill 目录 URL> [--tool claude|codex|cursor|gemini|workbuddy|kimi|pi] [--dry-run] [--yes]', 'Usage: skm install <local-dir|SKILL.md URL|GitHub/Gitee skill directory URL> [--tool claude|codex|cursor|gemini|workbuddy|kimi|pi] [--dry-run] [--yes]'));

  const payload = await loadInstallPayload(source, lang);
  if (!payload) return;
  const prepared = [];
  try {
    const targets = targetRoots(ctx.tool, ctx.cwd);
    const rows = targets.map((target) => {
      const dir = path.join(target.root, payload.dirName);
      const entry = { tool: target.catalogTool || target.tool, scope: 'user', dirName: payload.dirName, path: dir, realPath: dir };
      return { ...target, dir, entry: { ...entry, id: installationId(entry) }, exists: fs.existsSync(dir) };
    });
    printPlan(lang, zh(lang, 'skill 安装计划', 'Skill install plan'), rows.map((row) => [row.label, row.dir, row.exists ? zh(lang, '已存在', 'exists') : `${payload.kind} / ${shortHash(payload.packageHash)}`]));
    printSecurity(lang, payload);
    if (!securityAllowed(ctx, payload.findings, lang)) return;
    if (isDryRun(ctx)) return console.log(zh(lang, '[dry-run] 未写入 skill 目录。', '[dry-run] no skill directory written.'));
    if (rows.some((row) => row.exists)) return fail(lang, zh(lang, '目标目录已存在；请先处理重复项，或换一个 skill 名称。', 'Target directory already exists; resolve duplicates or use a different skill name.'));
    if (!(await confirm(zh(lang, '确认安装以上 skill？输入 yes 继续：', 'Install the skill above? Type yes to continue: '), confirmOptions(ctx.yes, lang)))) return;
    if (!ensureDataWritable(lang)) return;

    for (const row of rows) prepared.push({ row, ...prepareCandidate(payload, row.dir, copyDir) });
    const installed = [];
    try {
      for (const item of prepared) {
        atomicReplaceDirectory(item.stage, item.row.dir);
        item.stage = null;
        installed.push(item.row.dir);
      }
    } catch (error) {
      for (const dir of installed) fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    const sourceResults = prepared.map((item) => recordInstallSource(payload.dirName, { ...payload.sourceRecord, packageHash: item.manifest.hash }, item.row.entry.id));
    printIgnoredSourceFields(lang, payload.sourceRecord);
    if (!sourceResults.some((result) => result.hasUrl)) console.log(zh(lang, `提示：${payload.dirName} 缺少可升级来源。建议运行：skm sources add ${payload.dirName} --source <GitHub/Gitee skill目录或SKILL.md URL>`, `Tip: ${payload.dirName} has no upgrade source. Run: skm sources add ${payload.dirName} --source <GitHub/Gitee skill directory or SKILL.md URL>`));
    appendHistory({ type: 'install', skill: payload.dirName, source: payload.sourceRecord.source || source, instances: rows.map((row) => row.entry.id), tools: targets.map((target) => target.tool), targets: rows.map((row) => row.dir), packageHash: payload.packageHash });
    refreshCatalog(ctx, lang, 'install');
    console.log(paint.green(zh(lang, `安装完成：${payload.dirName}`, `Installed: ${payload.dirName}`)));
  } finally {
    for (const item of prepared) removePreparedCandidate(item.stage);
    payload.cleanup?.();
  }
}

export async function runSkillUpdate(ctx, args = []) {
  const name = args[0];
  const lang = ctx.lang || 'zh-CN';
  if (!name && !ctx.all) return fail(lang, zh(lang, '用法：skm update <skill名> [--tool ...] [--scope ...] [--instance ...] [--all] [--dry-run] [--yes]', 'Usage: skm update <skill-name> [--tool ...] [--scope ...] [--instance ...] [--all] [--dry-run] [--yes]'));
  refreshCatalog(ctx, lang, 'pre-update');
  const selected = selectLifecycleEntries(ctx, name, { allowMany: Boolean(ctx.all), requireSource: true, lang });
  if (!selected.length) return;
  const plans = [];
  try {
    for (const entry of selected) {
      const descriptor = sourceDescriptor(entry);
      const payload = await loadInstallPayload(descriptor, lang, entry.dirName);
      try {
        const targetDir = mutableTarget(entry);
        const prepared = prepareCandidate(payload, targetDir, copyDir);
        const currentManifest = buildPackageManifest(targetDir);
        const diff = diffPackageManifests(currentManifest, prepared.manifest);
        const stagedText = fs.readFileSync(path.join(prepared.stage, 'SKILL.md'), 'utf8');
        payload.findings = auditSkillDirectory(prepared.stage, { ...payload.skill, fileCount: prepared.manifest.fileCount, totalBytes: prepared.manifest.totalBytes }, stagedText);
        plans.push({ entry, descriptor, payload, targetDir, currentManifest, diff, ...prepared });
      } catch (error) {
        payload.cleanup?.();
        throw error;
      }
    }
    printUpdatePlans(plans, lang);
    for (const plan of plans) printSecurity(lang, plan.payload, plan.entry);
    if (!securityAllowed(ctx, plans.flatMap((plan) => plan.payload.findings), lang)) return;
    if (plans.every((plan) => plan.diff.same)) {
      console.log(paint.green(zh(lang, '所有目标已经与来源一致，无需更新。', 'All targets already match their sources; nothing to update.')));
      return;
    }
    if (isDryRun(ctx)) return console.log(zh(lang, '[dry-run] 未更新 skill。', '[dry-run] no skill updated.'));
    if (!(await confirm(zh(lang, `确认备份并更新 ${plans.filter((plan) => !plan.diff.same).length} 个实例？输入 yes 继续：`, `Back up and update ${plans.filter((plan) => !plan.diff.same).length} instance(s)? Type yes to continue: `), confirmOptions(ctx.yes, lang)))) return;

    const changedPlans = plans.filter((item) => !item.diff.same);
    for (const plan of changedPlans) plan.backup = backupSkillDir(plan.targetDir, plan.entry, 'update');
    atomicReplaceDirectories(changedPlans);
    for (const plan of changedPlans) plan.stage = null;
    for (const plan of changedPlans) {
      recordInstallSource(plan.entry.dirName, { ...plan.payload.sourceRecord, packageHash: plan.manifest.hash }, plan.entry.id || installationId(plan.entry));
      appendHistory({ type: 'update', skill: plan.entry.dirName, instance: plan.entry.id || installationId(plan.entry), tool: plan.entry.tool, scope: plan.entry.scope, source: plan.descriptor.url, target: plan.targetDir, backup: plan.backup, oldHash: plan.entry.skillMdHash, newHash: plan.payload.hash, oldPackageHash: plan.currentManifest.hash, newPackageHash: plan.manifest.hash, diff: summarizeDiff(plan.diff) });
      console.log(paint.green(zh(lang, `更新完成：${entryLabel(plan.entry)}（备份：${plan.backup}）`, `Updated: ${entryLabel(plan.entry)} (backup: ${plan.backup})`)));
    }
    refreshCatalog(ctx, lang, 'update');
  } finally {
    for (const plan of plans) {
      removePreparedCandidate(plan.stage);
      plan.payload.cleanup?.();
    }
  }
}

export async function runSkillRollback(ctx, args = []) {
  const name = args[0];
  const lang = ctx.lang || 'zh-CN';
  if (!name) return fail(lang, zh(lang, '用法：skm rollback <skill名> [--tool claude|codex|cursor|gemini|workbuddy|kimi|pi] [--dry-run] [--yes]', 'Usage: skm rollback <skill-name> [--tool claude|codex|cursor|gemini|workbuddy|kimi|pi] [--dry-run] [--yes]'));
  refreshCatalog(ctx, lang, 'pre-rollback');
  const entries = selectLifecycleEntries(ctx, name, { allowMany: Boolean(ctx.all), requireSource: false, lang });
  if (!entries.length) return;
  const plans = [];
  try {
    for (const entry of entries) {
      const targetDir = mutableTarget(entry);
      const currentManifest = buildPackageManifest(targetDir);
      const backup = latestBackup(entry, currentManifest.hash);
      if (!backup) return fail(lang, zh(lang, `没有可回滚备份：${entryLabel(entry)}`, `No rollback backup found: ${entryLabel(entry)}`));
      const prepared = prepareCandidate({ kind: 'directory', sourceDir: backup.payloadDir }, targetDir, copyDir);
      plans.push({ entry, targetDir, currentManifest, backup, ...prepared });
    }
    printPlan(lang, zh(lang, 'skill 回滚计划', 'Skill rollback plan'), plans.map((plan) => [entryLabel(plan.entry), plan.targetDir, `${shortHash(plan.currentManifest.hash)} -> ${shortHash(plan.manifest.hash)}`]));
    if (isDryRun(ctx)) return console.log(zh(lang, '[dry-run] 未执行回滚。', '[dry-run] rollback not executed.'));
    if (!(await confirm(zh(lang, `确认回滚 ${plans.length} 个实例？输入 yes 继续：`, `Rollback ${plans.length} instance(s)? Type yes to continue: `), confirmOptions(ctx.yes, lang)))) return;
    for (const plan of plans) plan.currentBackup = backupSkillDir(plan.targetDir, plan.entry, 'rollback-current');
    atomicReplaceDirectories(plans);
    for (const plan of plans) plan.stage = null;
    for (const plan of plans) {
      appendHistory({ type: 'rollback', skill: plan.entry.dirName, instance: plan.entry.id || installationId(plan.entry), tool: plan.entry.tool, scope: plan.entry.scope, target: plan.targetDir, restoredFrom: plan.backup.payloadDir, backupBeforeRollback: plan.currentBackup, oldPackageHash: plan.currentManifest.hash, newPackageHash: plan.manifest.hash });
      console.log(paint.green(zh(lang, `回滚完成：${entryLabel(plan.entry)}`, `Rolled back: ${entryLabel(plan.entry)}`)));
    }
    refreshCatalog(ctx, lang, 'rollback');
  } finally {
    for (const plan of plans) removePreparedCandidate(plan.stage);
  }
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

function selectLifecycleEntries(ctx, name, { allowMany, requireSource, lang }) {
  const catalog = ensureCatalog(ctx.cwd, lang);
  let entries = applySourcesToSkills(catalog.skills || []);
  if (name) entries = entries.filter((entry) => entry.dirName === name || entry.name === name);
  if (ctx.tool) entries = entries.filter((entry) => normalizeTool(entry.tool) === normalizeTool(ctx.tool));
  if (ctx.scope) entries = entries.filter((entry) => entry.scope === ctx.scope);
  if (ctx.instance) entries = entries.filter((entry) => (entry.id || installationId(entry)) === ctx.instance);
  const pluginEntries = entries.filter((entry) => entry.scope === 'plugin');
  if (pluginEntries.length) {
    fail(lang, zh(lang, `拒绝直接修改插件管理的 skill：${pluginEntries.map(entryLabel).join(', ')}。请通过插件管理器升级。`, `Refusing to modify plugin-managed skill: ${pluginEntries.map(entryLabel).join(', ')}. Update it through the plugin manager.`));
    return [];
  }
  const fileEntries = entries.filter((entry) => !safeDirectory(entry.realPath || entry.path));
  if (fileEntries.length) {
    fail(lang, zh(lang, `拒绝直接修改 Pi 文件型 skill：${fileEntries.map(entryLabel).join(', ')}。请在 Pi 的原始文件或 package 中管理。`, `Refusing to modify file-based Pi skills: ${fileEntries.map(entryLabel).join(', ')}. Manage them in the original Pi file or package.`));
    return [];
  }
  if (requireSource) {
    entries = entries.filter((entry) => {
      if (sourceDescriptor(entry, false)) return true;
      if (name) console.error(zh(lang, `缺少可更新来源：${entryLabel(entry)}。先用 skm sources add 补充。`, `Missing update source for ${entryLabel(entry)}. Add one with skm sources add first.`));
      return false;
    });
  }
  const seen = new Set();
  entries = entries.filter((entry) => {
    const key = entry.realPath || entry.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!entries.length) {
    if (!process.exitCode) fail(lang, name ? zh(lang, `目录中未找到可操作的 skill：${name}`, `No actionable skill found: ${name}`) : zh(lang, '没有带可更新来源的 skill。', 'No skills with actionable update sources were found.'));
    return [];
  }
  if (!allowMany && entries.length > 1) {
    const choices = entries.map((entry) => `${entryLabel(entry)} [${entry.id || installationId(entry)}]`).join('\n  ');
    fail(lang, zh(lang, `存在多个匹配实例，请加 --tool/--scope/--instance 精确选择，或加 --all：\n  ${choices}`, `Multiple installations match. Select one with --tool/--scope/--instance, or add --all:\n  ${choices}`));
    return [];
  }
  return entries;
}

async function loadInstallPayload(source, lang, forcedName = null) {
  const acquired = await acquireSkillSource(source);
  try {
    const sourceDir = acquired.kind === 'directory' ? acquired.sourceDir : null;
    const text = sourceDir ? fs.readFileSync(path.join(sourceDir, 'SKILL.md'), 'utf8') : acquired.text;
    const { data, hasFrontmatter } = parseFrontmatter(text);
    const sourceUrl = typeof source === 'string' ? source : source.url;
    const dirName = sanitizeName(forcedName || data.name || basenameFromSource(sourceUrl));
    const description = String(data.description || fallbackDescription(text) || '').trim();
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
    const manifest = acquired.manifest || null;
    const skill = { dirName, name: data.name || dirName, description, hasFrontmatter, skillMdHash: hash, skillMdBytes: Buffer.byteLength(text), fileCount: manifest?.fileCount || 1, totalBytes: manifest?.totalBytes || Buffer.byteLength(text), descTokens: estimateTokens(`${data.name || dirName} ${description}`) };
    const findings = sourceDir ? auditSkillDirectory(sourceDir, skill, text) : auditSkillSecurity(text, skill);
    const packageHash = manifest?.hash || crypto.createHash('sha256').update(`SKILL.md\0${text}`).digest('hex');
    return {
      ...acquired,
      dirName,
      text,
      sourceDir,
      skill,
      findings,
      hash,
      packageHash,
      sourceRecord: installSourceRecord(data, sourceUrl, { ...acquired, packageHash }),
    };
  } catch (error) {
    acquired.cleanup?.();
    throw error;
  }
}

function targetRoots(tool, cwd) {
  const normalized = normalizeTool(tool);
  const all = [
    { tool: 'claude-code', label: 'claude/user', root: CLAUDE_SKILLS_DIR },
    { tool: 'codex', label: 'codex/user', root: CODEX_SKILLS_DIR },
    { tool: 'cursor', label: 'cursor/user', root: CURSOR_SKILLS_DIRS[0] },
    { tool: 'gemini', label: 'gemini/user', root: GEMINI_SKILLS_DIRS[0] },
    { tool: 'workbuddy', label: 'workbuddy/user', root: WORKBUDDY_SKILLS_DIR },
    { tool: 'kimi', catalogTool: 'kimi', label: 'kimi/cli', root: KIMI_SKILLS_DIR },
    { tool: 'kimi-code', catalogTool: 'kimi', label: 'kimi/code', root: KIMI_CODE_SKILLS_DIR },
    { tool: 'kimi-desktop', catalogTool: 'kimi', label: 'kimi/desktop', root: KIMI_DESKTOP_SKILLS_DIR },
    { tool: 'pi', label: 'pi/user', root: PI_SKILLS_DIR },
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
    packageHash: skill.packageHash || null,
    lockedAt: new Date().toISOString(),
  };
}

function buildCurrentLock(ctx, { refresh }) {
  const lang = ctx.lang || 'zh-CN';
  if (refresh) runScanLocal({ cwd: ctx.cwd, silent: true, quiet: true, lang });
  const catalog = ensureCatalog(ctx.cwd, lang);
  const rows = applySourcesToSkills(catalog.skills || []).map((skill) => lockRow(skill));
  const items = assignLockKeys(rows).sort(compareLockItems);
  return { version: 3, generatedAt: new Date().toISOString(), items };
}

function loadLockFile(file, lang) {
  const data = loadJsonFile(file);
  if (!data) return { data: null };
  if (![1, 2, 3].includes(data.version) || !Array.isArray(data.items)) {
    return { data: null, error: zh(lang, `锁定文件格式无效：${file}`, `Invalid lock file format: ${file}`) };
  }
  if (data.version < 3 || data.items.some((item) => !item.key || !item.packageHash)) {
    return { data: null, error: zh(lang, `锁定文件来自旧版格式，缺少实例级完整目录 hash。请重新运行 skm lock 建立新基线：${file}`, `The lock file uses an older format without per-installation package hashes. Re-run skm lock to establish a new baseline: ${file}`) };
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
    version: 3,
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
    packageHash: item.packageHash || null,
  };
}

function changedFields(before, after) {
  return ['title', 'tool', 'scope', 'tools', 'locationHash', 'version', 'source', 'gitHead', 'skillMdHash', 'packageHash'].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
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

function installSourceRecord(data, source, acquired = {}) {
  const declaredUrl = [data.source, data.repository || data.repo, data.homepage].some((value) => isValidSourceUrl(cleanText(value)));
  const installedUrl = isValidSourceUrl(source);
  const record = {
    source: validUrlOrNull(data.source),
    repository: validUrlOrNull(data.repository || data.repo),
    homepage: validUrlOrNull(data.homepage),
    version: cleanText(data.version),
    ref: cleanText(acquired.ref),
    subdir: cleanText(acquired.subdir),
    resolvedCommit: cleanText(acquired.resolvedCommit),
    packageHash: cleanText(acquired.packageHash),
    discovery: declaredUrl
      ? { method: 'frontmatter', confirmedByUser: false }
      : installedUrl
        ? { method: 'install-url', verifiedAt: new Date().toISOString(), confirmedByUser: true }
        : null,
  };
  record.ignoredFields = ignoredSourceFields(data);
  if (!record.source && !record.repository && !record.homepage && isValidSourceUrl(source)) record.source = source;
  return record;
}

function recordInstallSource(name, record, instanceId = null) {
  const hasUrl = Boolean(record?.source || record?.repository || record?.homepage);
  const hasMetadata = hasUrl || Boolean(record?.version);
  if (!hasMetadata) return { saved: false, hasUrl, source: null };
  if (instanceId) upsertSource(name, record, { instanceId });
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

function refreshCatalog(ctx, lang, action) {
  try {
    runScanLocal({ cwd: ctx.cwd, silent: true, quiet: true, lang });
  } catch (e) {
    if (String(action).startsWith('pre-')) throw e;
    console.error(zh(lang, `提示：${action} 已完成，但自动刷新 catalog 失败。请手动运行 skm scan。原因：${e.message}`, `Tip: ${action} completed, but automatic catalog refresh failed. Run skm scan manually. Reason: ${e.message}`));
  }
}

function sourceDescriptor(entry, strict = true) {
  const upstream = entry.upstream || {};
  const url = upstream.source || upstream.repository || upstream.homepage || upstream.git?.remote;
  if (!url) return null;
  const actionable = isActionableSource(url);
  if (!actionable) {
    if (strict) throw new Error(`source is not directly readable as a skill package: ${url}`);
    return null;
  }
  return {
    url,
    ref: upstream.ref || branchFromUpstreamRef(upstream.git?.upstreamRef) || upstream.git?.branch || null,
    subdir: upstream.subdir || upstream.git?.relativePath || null,
  };
}

function isActionableSource(value) {
  const text = String(value || '');
  if (/^file:\/\//i.test(text)) return true;
  if (/^(git@|ssh:\/\/)/i.test(text) || /\.git(?:[#?].*)?$/i.test(text)) return true;
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    return ['github.com', 'gitee.com'].includes(url.hostname) || /\/SKILL\.md$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function mutableTarget(entry) {
  const configured = path.resolve(entry.path);
  const real = entry.realPath ? path.resolve(entry.realPath) : configured;
  return real !== configured ? real : configured;
}

function entryLabel(entry) {
  return `${entry.dirName} (${entry.tool || 'unknown'}/${entry.scope || 'unknown'})`;
}

function printUpdatePlans(plans, lang) {
  printPlan(lang, zh(lang, 'skill 更新计划', 'Skill update plan'), plans.map((plan) => [
    entryLabel(plan.entry),
    `${shortHash(plan.currentManifest.hash)} -> ${shortHash(plan.manifest.hash)}`,
    plan.diff.same
      ? zh(lang, '内容一致', 'same content')
      : `+${plan.diff.added.length} ~${plan.diff.changed.length} -${plan.diff.removed.length}`,
  ]));
  for (const plan of plans.filter((item) => !item.diff.same)) {
    const files = [
      ...plan.diff.added.slice(0, 5).map((file) => `+ ${file}`),
      ...plan.diff.changed.slice(0, 5).map((file) => `~ ${file}`),
      ...plan.diff.removed.slice(0, 5).map((file) => `- ${file}`),
    ];
    if (files.length) console.log(`\n${entryLabel(plan.entry)}\n  ${files.join('\n  ')}`);
  }
}

function securityAllowed(ctx, findings, lang) {
  const summary = summarizeFindings(findings);
  const policy = loadJsonFile(POLICY_PATH) || defaultPolicy();
  if (!policy.blockHighSecurityFindings || !summary.high || ctx.allowRisk || ctx['allow-risk']) return true;
  console.error(paint.red(zh(lang, `发现 ${summary.high} 个高危安全项，策略已阻止写入。人工复核后可显式加 --allow-risk。`, `${summary.high} high-severity finding(s) blocked the write by policy. Review them, then add --allow-risk explicitly to proceed.`)));
  for (const finding of findings.filter((item) => item.severity === 'high').slice(0, 10)) {
    const localized = localizeSecurityFinding(finding, lang);
    console.error(`  ${finding.targetFile || 'SKILL.md'}: ${localized.title}${finding.evidence ? ` (${finding.evidence})` : ''}`);
  }
  process.exitCode = 1;
  return false;
}

function summarizeDiff(diff) {
  return { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length };
}

function shortHash(value) {
  return value ? String(value).slice(0, 12) : '—';
}

function branchFromUpstreamRef(ref) {
  const text = String(ref || '');
  const slash = text.indexOf('/');
  return slash >= 0 ? text.slice(slash + 1) : text || null;
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
  const highSecurity = catalog.security?.summary?.high || 0;
  const items = [
    checkRule('maxSkills', merged.length <= policy.maxSkills, `${merged.length} <= ${policy.maxSkills}`),
    checkRule('maxNeverUsedRate', neverUsed.length / Math.max(1, merged.length) <= policy.maxNeverUsedRate, `${Math.round(neverUsed.length / Math.max(1, merged.length) * 100)}% <= ${Math.round(policy.maxNeverUsedRate * 100)}%`),
    checkRule('maxDuplicateInstalls', duplicate.length <= policy.maxDuplicateInstalls, `${duplicate.length} <= ${policy.maxDuplicateInstalls}`),
    checkRule('requireSource', !policy.requireSource || missingSource.length === 0, policy.requireSource ? `${missingSource.length} missing` : 'disabled'),
    checkRule('blockHighSecurityFindings', !policy.blockHighSecurityFindings || highSecurity === 0, `${highSecurity} high`),
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

function printSecurity(lang, payload, entry = null) {
  const summary = summarizeFindings(payload.findings);
  const prefix = entry ? `${entryLabel(entry)} ` : '';
  console.log(prefix + zh(lang, `安全审计：高 ${summary.high || 0} / 中 ${summary.medium || 0} / 低 ${summary.low || 0} / 信息 ${summary.info || 0}`, `Security audit: high ${summary.high || 0} / medium ${summary.medium || 0} / low ${summary.low || 0} / info ${summary.info || 0}`));
  for (const finding of payload.findings.filter((item) => ['high', 'medium'].includes(item.severity)).slice(0, 8)) {
    const localized = localizeSecurityFinding(finding, lang);
    console.log(`  - ${finding.severity} ${finding.targetFile || 'SKILL.md'}: ${localized.title}${finding.evidence ? ` (${finding.evidence})` : ''}`);
  }
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

function backupSkillDir(dir, entry, type) {
  const id = entry.id || installationId(entry);
  const root = path.join(SKILL_BACKUP_DIR, sanitizeName(id));
  const target = uniqueBackupPath(root, `${fileStamp()}-${sanitizeName(type)}`);
  const payloadDir = path.join(target, 'payload');
  fs.mkdirSync(root, { recursive: true });
  copyDir(dir, payloadDir);
  const manifest = buildPackageManifest(payloadDir);
  saveJsonFile(path.join(target, 'metadata.json'), {
    version: 2,
    createdAt: new Date().toISOString(),
    type,
    instanceId: id,
    skill: entry.dirName,
    tool: entry.tool,
    scope: entry.scope,
    sourcePath: dir,
    packageHash: manifest.hash,
  }, { pretty: true });
  return target;
}

function backupFile(file, label) {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `${sanitizeName(label)}.${fileStamp()}.bak`);
  fs.copyFileSync(file, backup);
  return backup;
}

function latestBackup(entry, currentPackageHash) {
  const id = entry.id || installationId(entry);
  const roots = [path.join(SKILL_BACKUP_DIR, sanitizeName(id))];
  const candidates = [];
  for (const root of roots) {
    let names;
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const snapshot = path.join(root, name);
      if (!safeDirectory(snapshot)) continue;
      const metadata = loadJsonFile(path.join(snapshot, 'metadata.json'));
      const payloadDir = safeDirectory(path.join(snapshot, 'payload')) ? path.join(snapshot, 'payload') : snapshot;
      let hash = metadata?.packageHash || null;
      try {
        hash ||= buildPackageManifest(payloadDir).hash;
      } catch {
        continue;
      }
      if (hash === currentPackageHash) continue;
      candidates.push({ snapshot, payloadDir, metadata, hash, order: metadata?.createdAt || name });
    }
  }
  return candidates.sort((a, b) => a.order.localeCompare(b.order)).pop() || null;
}

function copyDir(from, to) {
  const rootStat = fs.statSync(from);
  fs.mkdirSync(to, { recursive: true, mode: rootStat.mode & 0o777 });
  fs.chmodSync(to, rootStat.mode & 0o777);
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (ent.name === '.git') continue;
    const src = path.join(from, ent.name);
    const dst = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(src, dst);
    else if (ent.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (ent.isFile()) {
      fs.copyFileSync(src, dst);
      fs.chmodSync(dst, fs.statSync(src).mode & 0o777);
    }
  }
}

function uniqueBackupPath(root, base) {
  let candidate = path.join(root, base);
  let i = 2;
  while (fs.existsSync(candidate)) candidate = path.join(root, `${base}-${i++}`);
  return candidate;
}

function safeDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function basenameFromSource(source) {
  const clean = String(source).replace(/[?#].*$/, '').replace(/\/+$/, '');
  return clean.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || 'skill';
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
