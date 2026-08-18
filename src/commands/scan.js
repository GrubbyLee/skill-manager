import { scanClaudeCode } from '../adapters/claudeCode.js';
import { scanCodex } from '../adapters/codex.js';
import { scanCursor } from '../adapters/cursor.js';
import { scanGemini } from '../adapters/gemini.js';
import { scanWorkBuddy } from '../adapters/workbuddy.js';
import { scanKimi } from '../adapters/kimi.js';
import { loadRules, classify } from '../classify.js';
import { saveCatalog, loadCatalog, mergeByDirName, CATALOG_REL } from '../catalog.js';
import { renderTable, termWidth } from '../table.js';
import { paint, paintErr } from '../utils.js';
import { tr } from '../i18n.js';
import { anonymizeCatalog } from '../anonymize.js';
import { collectSecurityReport, formatSecuritySummary } from '../securityAudit.js';
import { applySourcesToSkills, loadSources } from '../sources.js';
import { scanUsage } from '../usage.js';
import { buildSessionIndex } from '../sessionsIndex.js';
import { buildOverview, renderOverview } from '../overview.js';
import { collectOutdatedRows } from './outdated.js';
import fs from 'node:fs';
import path from 'node:path';

const FRESHNESS_TTL_MS = 24 * 60 * 60 * 1000;

export async function runScan(options) {
  const snapshot = collectLocalInventory(options.cwd);
  const freshnessRows = await collectOutdatedRows(snapshot.skills, {
    online: true,
    refresh: options.refresh || false,
    cacheOnly: !options.online,
    lang: options.lang || 'zh-CN',
  });
  return finishScan(options, snapshot, freshnessRows);
}

// 内部命令需要同步刷新目录，避免把原有同步调用链扩散为 Promise。
export function runScanLocal(options) {
  return finishScan(options, collectLocalInventory(options.cwd), [], { previousCatalog: loadCatalog() });
}

function collectLocalInventory(cwd) {
  const claude = scanClaudeCode({ cwd });
  const codex = scanCodex();
  const cursor = scanCursor({ cwd });
  const gemini = scanGemini({ cwd });
  const workbuddy = scanWorkBuddy({ cwd });
  const kimi = scanKimi({ cwd });
  const ruleSet = loadRules();
  const sourceMap = loadSources();
  const skills = applySourcesToSkills([...claude.skills, ...codex.skills, ...cursor.skills, ...gemini.skills, ...workbuddy.skills, ...kimi.skills], sourceMap).map((s) => ({
    ...s,
    category: classify(s, ruleSet),
  }));
  return {
    skills,
    mcpServers: [...claude.mcpServers, ...codex.mcpServers, ...cursor.mcpServers, ...gemini.mcpServers, ...workbuddy.mcpServers, ...kimi.mcpServers],
    warnings: [...claude.warnings, ...codex.warnings, ...cursor.warnings, ...gemini.warnings, ...workbuddy.warnings, ...kimi.warnings],
    archived: { 'claude-code': claude.archived, codex: codex.archived, cursor: cursor.archived, gemini: gemini.archived, workbuddy: workbuddy.archived, kimi: kimi.archived },
  };
}

// silent 模式：汇总走 stderr，保证 --json 消费方的 stdout 干净（兜底重扫场景）
function finishScan({ cwd, json = false, verbose = false, silent = false, quiet = false, online = false, lang = 'zh-CN', export: exportFormat, output, anonymize = false }, snapshot, freshnessRows, { previousCatalog = null } = {}) {
  const print = quiet ? () => {} : silent ? console.error : console.log;
  // 着色按实际写入的流判断（stdout 与 stderr 的 TTY 状态可能不同）
  const pal = silent ? paintErr : paint;
  const { mcpServers, warnings, archived } = snapshot;
  const freshnessByInstance = new Map(freshnessRows.map((row) => [row.instanceId, row]));
  const previousByInstance = new Map((previousCatalog?.skills || []).map((skill) => [scanSkillKey(skill), skill]));
  const skills = snapshot.skills.map((skill) => ({
    ...skill,
    upstreamFreshness: freshnessRecord(freshnessByInstance.get(skill.id)) || preservedFreshness(skill, previousByInstance),
  }));
  const security = collectSecurityReport({ skills, mcpServers });

  const catalog = {
    version: 1,
    scannedAt: new Date().toISOString(),
    scanCwd: cwd,
    skills,
    mcpServers,
    security,
    warnings,
    archived,
  };
  saveCatalog(catalog);

  if (json || exportFormat) {
    const exported = anonymize ? anonymizeCatalog(catalog) : catalog;
    const text = JSON.stringify(exported, null, 2);
    if (output) {
      writeTextFile(output, text);
      print(tr(lang, 'scan.exported', { output, anonymize }));
    } else {
      console.log(text);
    }
    return;
  }

  const merged = mergeByDirName(skills);
  const both = merged.filter((m) => m.tools.length > 1).length;
  const byCat = new Map();
  for (const m of merged) byCat.set(m.category, (byCat.get(m.category) || 0) + 1);

  const skillStats = (tool) => {
    const list = skills.filter((s) => s.tool === tool);
    return {
      skills: list.length,
      user: list.filter((s) => s.scope === 'user').length,
      project: list.filter((s) => s.scope === 'project').length,
      plugin: list.filter((s) => s.scope === 'plugin').length,
      mcp: mcpServers.filter((s) => s.tool === tool).length,
      archived: catalog.archived[tool],
      tokens: list.reduce((sum, s) => sum + s.descTokens, 0),
    };
  };

  print(pal.green(tr(lang, 'scan.done')));
  const width = termWidth();
  const claudeStats = skillStats('claude-code');
  const codexStats = skillStats('codex');
  const cursorStats = skillStats('cursor');
  const geminiStats = skillStats('gemini');
  const workbuddyStats = skillStats('workbuddy');
  const kimiStats = skillStats('kimi');

  print(`\n${tr(lang, 'scan.overview')}`);
  print(renderTable(
    [
      { title: tr(lang, 'scan.col.tool'), width: 12 },
      { title: 'skill', width: 6 },
      { title: tr(lang, 'scan.col.user'), width: 6 },
      { title: tr(lang, 'scan.col.project'), width: 6 },
      { title: tr(lang, 'scan.col.plugin'), width: 6 },
      { title: 'MCP', width: 5 },
      { title: tr(lang, 'scan.col.archived'), width: 8 },
      { title: tr(lang, 'scan.col.context'), width: 0 },
    ],
    [
      ['Claude Code', claudeStats.skills, claudeStats.user, claudeStats.project, claudeStats.plugin, claudeStats.mcp, claudeStats.archived, tr(lang, 'scan.tokens', { n: claudeStats.tokens })],
      ['Codex', codexStats.skills, codexStats.user, codexStats.project, codexStats.plugin, codexStats.mcp, codexStats.archived, tr(lang, 'scan.tokens', { n: codexStats.tokens })],
      ['Cursor', cursorStats.skills, cursorStats.user, cursorStats.project, cursorStats.plugin, cursorStats.mcp, cursorStats.archived, tr(lang, 'scan.tokens', { n: cursorStats.tokens })],
      ['Gemini CLI', geminiStats.skills, geminiStats.user, geminiStats.project, geminiStats.plugin, geminiStats.mcp, geminiStats.archived, tr(lang, 'scan.tokens', { n: geminiStats.tokens })],
      ['WorkBuddy', workbuddyStats.skills, workbuddyStats.user, workbuddyStats.project, workbuddyStats.plugin, workbuddyStats.mcp, workbuddyStats.archived, tr(lang, 'scan.tokens', { n: workbuddyStats.tokens })],
      ['Kimi', kimiStats.skills, kimiStats.user, kimiStats.project, kimiStats.plugin, kimiStats.mcp, kimiStats.archived, tr(lang, 'scan.tokens', { n: kimiStats.tokens })],
    ],
    Math.min(width, 100),
  ));

  print(`\n${tr(lang, 'scan.summary')}`);
  print(renderTable(
    [
      { title: tr(lang, 'scan.col.metric'), width: 24 },
      { title: tr(lang, 'scan.col.value'), width: 0 },
    ],
    [
      [tr(lang, 'scan.metric.uniqueSkills'), tr(lang, 'scan.unit.items', { n: merged.length })],
      [tr(lang, 'scan.metric.sameNameBoth'), tr(lang, 'scan.unit.items', { n: both })],
      [tr(lang, 'scan.metric.security'), formatSecuritySummary(security.summary, lang)],
      [tr(lang, 'scan.metric.warnings'), tr(lang, 'scan.unit.warnings', { n: warnings.length })],
      [tr(lang, 'scan.metric.catalogFile'), CATALOG_REL],
    ],
    Math.min(width, 90),
  ));

  const upgradeRows = freshnessRows.filter((row) => ['outdated', 'diverged'].includes(row.status));
  const unresolvedRows = freshnessRows.filter((row) => ['unchecked', 'unknown', 'untracked'].includes(row.status));
  if (upgradeRows.length) {
    print(`\n${pal.yellow(tr(lang, 'scan.updatesFound', { count: upgradeRows.length }))}`);
    print(renderTable(
      [
        { title: tr(lang, 'outdated.col.name'), width: 28 },
        { title: tr(lang, 'outdated.col.current'), width: 14 },
        { title: tr(lang, 'outdated.col.status'), width: 12 },
        { title: tr(lang, 'outdated.col.suggestion'), width: 0 },
      ],
      upgradeRows.slice(0, 20).map((row) => [
        `${row.dirName} (${row.tool || '—'})`,
        row.current || '—',
        tr(lang, `outdated.status.${row.status}`),
        `skm update ${row.dirName} --instance ${row.instanceId} --dry-run`,
      ]),
      Math.min(width, 110),
    ));
  }
  if (online && unresolvedRows.length) {
    const checked = freshnessRows.length - unresolvedRows.length;
    const unknown = unresolvedRows.filter((row) => ['unchecked', 'unknown'].includes(row.status)).length;
    const untracked = unresolvedRows.filter((row) => row.status === 'untracked').length;
    print(`\n${pal.yellow(tr(lang, 'scan.updatesIncomplete', { checked, total: freshnessRows.length, unknown, untracked }))}`);
  } else if (online && !upgradeRows.length) {
    print(`\n${pal.green(tr(lang, 'scan.noUpdatesFound'))}`);
  }

  print(`\n${tr(lang, 'scan.categories')}`);
  print(renderTable(
    [
      { title: tr(lang, 'scan.col.category'), width: 24 },
      { title: tr(lang, 'scan.col.count'), width: 0 },
    ],
    [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, tr(lang, 'scan.unit.items', { n })]),
    Math.min(width, 80),
  ));
  if (Object.values(catalog.archived).reduce((sum, n) => sum + n, 0) > 0) {
    print(`\n${tr(lang, 'scan.archivedNote')}`);
  }
  if (warnings.length) {
    print(pal.yellow(tr(lang, 'scan.warningSummary', { n: warnings.length, verbose })));
    if (verbose) for (const w of warnings) print(pal.yellow(`    - ${w}`));
  }
  print(`\n${tr(lang, 'scan.catalogWritten', { file: CATALOG_REL })}`);

  if (!silent) {
    print(`\n${tr(lang, 'scan.overviewAfterScan')}`);
    const usage = scanUsage({ log: (msg) => console.error(msg), lang });
    const sessions = buildSessionIndex();
    print(renderOverview(buildOverview({ catalog, usage, sessions, lang }), lang));
  }
}

function freshnessRecord(row) {
  if (!row || ['unchecked', 'untracked'].includes(row.status)) return null;
  return {
    status: row.status,
    checkedAt: row.checkedAt || null,
    cached: Boolean(row.cached),
    remoteVersion: row.remoteVersion || null,
    remoteCommit: row.remoteCommit || null,
    remotePackageHash: row.remotePackageHash || null,
  };
}

function preservedFreshness(skill, previousByInstance) {
  const previous = previousByInstance.get(scanSkillKey(skill));
  const freshness = previous?.upstreamFreshness;
  if (!freshness || freshnessFingerprint(previous) !== freshnessFingerprint(skill)) return null;
  const checkedAt = Date.parse(freshness.checkedAt || '');
  const age = Date.now() - checkedAt;
  if (!Number.isFinite(checkedAt) || age < 0 || age >= FRESHNESS_TTL_MS) return null;
  return { ...freshness, cached: true };
}

function scanSkillKey(skill) {
  return skill.id || `${skill.tool || ''}\0${skill.scope || ''}\0${skill.realPath || skill.path || ''}`;
}

function freshnessFingerprint(skill) {
  const upstream = skill.upstream || {};
  return JSON.stringify({
    skillMdHash: skill.skillMdHash || null,
    packageHash: skill.packageHash || null,
    version: upstream.version || null,
    source: upstream.source || null,
    repository: upstream.repository || null,
    homepage: upstream.homepage || null,
    ref: upstream.ref || null,
    subdir: upstream.subdir || null,
    gitRemote: upstream.git?.remote || null,
    gitHead: upstream.git?.head || null,
  });
}

function writeTextFile(file, text) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, text);
}

// 各命令的统一兜底：目录缺失/损坏 → 静默重扫（汇总走 stderr）→ 仍失败则抛出明确错误
export function ensureCatalog(cwd, lang = 'zh-CN') {
  let catalog = loadCatalog();
  if (!catalog || isCatalogOutdated(catalog)) {
    console.error(tr(lang, catalog ? 'scan.catalogOutdated' : 'scan.catalogMissing'));
    runScanLocal({ cwd, silent: true, lang });
    catalog = loadCatalog();
  }
  if (!catalog) throw new Error(tr(lang, 'scan.catalogLoadFailed'));
  return catalog;
}

function isCatalogOutdated(catalog) {
  if (!catalog.security || !Array.isArray(catalog.security.findings)) return true;
  if ((catalog.skills || []).some((skill) => !skill.upstream)) return true;
  return (catalog.skills || []).some((skill) => !Array.isArray(skill.securityFindings));
}
