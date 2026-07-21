import fs from 'node:fs';
import path from 'node:path';
import { mergeByDirName, toolLabel } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { buildCleanupTips, findIdleMcp } from '../advice.js';
import { renderTable, termWidth } from '../table.js';
import { ensureCatalog } from './scan.js';
import { DATA_DIR } from '../paths.js';
import { fmtDay, fmtDateTime, fileStamp, DAY_MS, paint } from '../utils.js';
import { fmtAgoLang, tr } from '../i18n.js';

const ZOMBIE_DAYS = 90;
const HISTORY_DIR = path.join(DATA_DIR, 'audit-history');

// 健康审计：使用频率、僵尸 skill、MCP 使用情况、上下文/磁盘开销
export function runAudit({ cwd, json = false, history = false, lang = 'zh-CN' }) {
  if (history) return showHistory({ json, lang });

  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(catalog.skills);
  if (!merged.length) {
    console.log(tr(lang, 'audit.empty'));
    return;
  }

  console.error(tr(lang, 'audit.loading'));
  const usage = scanUsage({ log: (msg) => console.error(msg), lang });
  const usageOf = buildUsageLookup(merged, usage);

  const now = Date.now();
  const rows = merged
    .map((m) => ({ m, u: usageOf(m) }))
    .sort((x, y) => y.u.count - x.u.count);
  const used = rows.filter((r) => r.u.count > 0);
  const neverUsed = rows.filter((r) => r.u.count === 0);
  const stale = used.filter((r) => r.u.lastUsed && now - Date.parse(r.u.lastUsed) > ZOMBIE_DAYS * DAY_MS);

  // 每次审计自动归档快照（聚合数据仅几十 KB），日志被清理后仍可回看历史结论
  archiveSnapshot({
    archivedAt: new Date().toISOString(),
    observedSince: usage.earliest,
    totalSkills: merged.length,
    usedCount: used.length,
    neverUsedCount: neverUsed.length,
    staleCount: stale.length,
    usage: used.map((r) => ({ dirName: r.m.dirName, count: r.u.count, lastUsed: r.u.lastUsed })),
    neverUsed: neverUsed.map((r) => r.m.dirName),
    mcpUsage: usage.mcp,
  }, lang);

  if (json) {
    console.log(JSON.stringify({
      observedSince: usage.earliest,
      usage: rows.map((r) => ({ dirName: r.m.dirName, category: r.m.category, tools: r.m.tools, count: r.u.count, lastUsed: r.u.lastUsed })),
      neverUsed: neverUsed.map((r) => r.m.dirName),
      staleOver90d: stale.map((r) => r.m.dirName),
      mcpUsage: usage.mcp,
    }, null, 2));
    return;
  }

  const width = termWidth();

  console.log(`${tr(lang, 'audit.window', { since: fmtDay(usage.earliest) })}\n`);

  console.log(paint.bold(tr(lang, 'audit.topTitle', { count: used.length })));
  console.log(renderTable(
    [{ title: tr(lang, 'audit.col.name'), width: 30 }, { title: tr(lang, 'audit.col.count'), width: 5 }, { title: tr(lang, 'audit.col.lastUsed'), width: 10 }, { title: tr(lang, 'audit.col.category'), width: 0 }],
    used.slice(0, 20).map((r) => [r.m.dirName, r.u.count, fmtAgoLang(lang, r.u.lastUsed), r.m.category]),
    width,
  ));

  console.log('\n' + paint.bold(paint.red(tr(lang, 'audit.zombieTitle', { count: neverUsed.length, pct: Math.round((neverUsed.length / merged.length) * 100) }))));
  const byCat = new Map();
  for (const r of neverUsed) {
    if (!byCat.has(r.m.category)) byCat.set(r.m.category, []);
    byCat.get(r.m.category).push(r.m.dirName);
  }
  for (const [cat, names] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(tr(lang, 'audit.categoryLine', { category: cat, count: names.length, names: joinNames(names, lang) }));
  }
  if (stale.length) {
    console.log(tr(lang, 'audit.staleLine', { count: stale.length, days: ZOMBIE_DAYS, names: joinNames(stale.map((r) => r.m.dirName), lang) }));
  }

  console.log('\n' + paint.bold(tr(lang, 'audit.mcpTitle')));
  const { idle: idleMcp, unobservable: codexOnlyMcp } = findIdleMcp(catalog.mcpServers, usage);
  const codexOnlySet = new Set(codexOnlyMcp);
  const mcpNames = new Set(catalog.mcpServers.map((s) => s.name));
  const mcpRows = [...mcpNames].map((name) => {
    if (codexOnlySet.has(name)) return [name, tr(lang, 'audit.unobservable'), '—'];
    const u = usage.mcp[name];
    return [name, u?.count || 0, fmtAgoLang(lang, u?.lastUsed ?? null)];
  }).sort((a, b) => (typeof b[1] === 'number' ? b[1] : -1) - (typeof a[1] === 'number' ? a[1] : -1));
  console.log(renderTable(
    [{ title: tr(lang, 'audit.col.name'), width: 20 }, { title: tr(lang, 'audit.col.count'), width: 8 }, { title: tr(lang, 'audit.col.lastUsed'), width: 0 }],
    mcpRows,
    Math.min(width, 60),
  ));
  if (idleMcp.length) console.log(paint.yellow(tr(lang, 'audit.idleMcp', { names: joinNames(idleMcp, lang) })));

  console.log('\n' + paint.bold(tr(lang, 'audit.contextTitle')));
  const costTop = [...merged].sort((a, b) => b.descTokens - a.descTokens).slice(0, 10);
  for (const m of costTop) {
    const u = usageOf(m);
    console.log(tr(lang, 'audit.contextLine', { tokens: String(m.descTokens).padStart(4), name: m.dirName, tool: localizedToolLabel(m.tools, lang), count: u.count }));
  }

  // 建议与 status 仪表盘共用同一生成逻辑，保证命令与口径一致
  const { tips } = buildCleanupTips({ merged, usageOf, idleMcp });
  console.log('\n' + paint.bold(tr(lang, 'audit.advice')));
  let n = 0;
  for (const tip of tips) {
    const localized = localizeTip(tip, lang);
    console.log(`  ${++n}. ${localized.text}${lang === 'en' ? ': ' : '：'}${paint.cyan(localized.command)}${localized.note ? paint.gray(localized.note) : ''}`);
  }
  console.log(`  ${++n}. ${tr(lang, 'audit.dupesTip')}${lang === 'en' ? ': ' : '：'}${paint.cyan('skm dupes')}`);
}

function archiveSnapshot(snapshot, lang = 'zh-CN') {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    // 文件名用 Asia/Shanghai 本地时间戳；同一秒内重复运行覆盖同名文件，属预期（避免归档爆炸）
    fs.writeFileSync(path.join(HISTORY_DIR, `audit-${fileStamp()}.json`), JSON.stringify(snapshot, null, 2));
  } catch (e) {
    console.error(tr(lang, 'audit.archiveFailed', { message: e.message }));
  }
}

function showHistory({ json = false, lang = 'zh-CN' }) {
  let files;
  try {
    files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).sort();
  } catch {
    files = [];
  }
  const snapshots = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
      snapshots.push({ file: f, ...s });
    } catch {
      /* 跳过损坏的归档 */
    }
  }
  if (json) {
    console.log(JSON.stringify(snapshots.map(({ usage, neverUsed, mcpUsage, ...summary }) => summary), null, 2));
    return;
  }
  if (!snapshots.length) {
    console.log(tr(lang, 'audit.historyEmpty'));
    return;
  }
  console.log(renderTable(
    [{ title: tr(lang, 'audit.col.archiveTime'), width: 17 }, { title: tr(lang, 'audit.col.total'), width: 5 }, { title: tr(lang, 'audit.col.used'), width: 5 }, { title: tr(lang, 'audit.col.zombie'), width: 6 }, { title: tr(lang, 'audit.col.file'), width: 0 }],
    snapshots.map((s) => [fmtDateTime(s.archivedAt), s.totalSkills, s.usedCount, s.neverUsedCount, s.file]),
    termWidth(),
  ));
  console.log(`\n${tr(lang, 'audit.historyDir', { dir: HISTORY_DIR })}`);
}

function joinNames(names, lang) {
  return names.join(lang === 'en' ? ', ' : '、');
}

function localizedToolLabel(tools, lang) {
  const label = toolLabel(tools);
  return label === '两侧' ? tr(lang, 'tool.both') : label;
}

function localizeTip(tip, lang) {
  if (lang !== 'en') return tip;
  if (tip.text.startsWith('双份且从未使用')) {
    const count = tip.text.match(/\d+/)?.[0] || '';
    return {
      ...tip,
      text: `Duplicate and never-used skills: ${count}; clean these first`,
      note: tip.note ? ' (first 5 only; full list: skm audit --json)' : '',
    };
  }
  if (tip.text === '禁用闲置 MCP') return { ...tip, text: 'Disable idle MCP servers' };
  return tip;
}
