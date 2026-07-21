import fs from 'node:fs';
import path from 'node:path';
import { mergeByDirName, isDupEntity, toolLabel } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { buildSessionIndex, planClean } from '../sessionsIndex.js';
import { findIdleMcp } from '../advice.js';
import { ensureCatalog } from './scan.js';
import { collectRisks } from './risks.js';
import { buildKnowledgeGraph } from './graph.js';
import { computeHealthScore } from './status.js';
import { renderTable, termWidth } from '../table.js';
import { fmtAgoLang, tr } from '../i18n.js';
import { fmtBytes, fmtDateTime, fmtDay, paint } from '../utils.js';

export function runReport({ cwd, json = false, format, output, lang = 'zh-CN' }) {
  const resolvedFormat = json ? 'json' : (format || (output ? inferFormat(output) : 'summary'));
  if (!['summary', 'html', 'json'].includes(resolvedFormat)) {
    throw new Error(tr(lang, 'report.unsupportedFormat', { format: resolvedFormat }));
  }

  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(catalog.skills || []);
  if (!merged.length) {
    console.log(tr(lang, 'report.empty'));
    return;
  }

  console.error(tr(lang, 'report.loading'));
  const usage = scanUsage({ log: (msg) => console.error(msg), lang });
  const sessions = buildSessionIndex();
  const data = buildReportData({ catalog, merged, usage, sessions, lang });

  if (resolvedFormat === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (resolvedFormat === 'html') {
    const html = renderReportHtml(data, lang);
    if (output) {
      writeTextFile(output, html);
      console.log(tr(lang, 'report.exported', { output }));
    } else {
      console.log(html);
    }
    return;
  }

  printReportSummary(data, lang);
}

export function buildReportData({ catalog, merged = mergeByDirName(catalog.skills || []), usage, sessions = [], lang = 'zh-CN' }) {
  const usageOf = buildUsageLookup(merged, usage);
  const rows = merged.map((skill) => ({ skill, usage: usageOf(skill) }));
  const used = rows.filter((r) => r.usage.count > 0).sort((a, b) => b.usage.count - a.usage.count);
  const neverUsed = rows.filter((r) => r.usage.count === 0);
  const dupEntities = merged.filter(isDupEntity);
  const { idle: idleMcp, unobservable: unobservableMcp } = findIdleMcp(catalog.mcpServers || [], usage);
  const sessionBytes = sessions.reduce((sum, s) => sum + s.size, 0);
  const cleanPlan = planClean(sessions, { keep: 3, days: 30 });
  const reclaimBytes = cleanPlan.groups.flatMap((g) => g.toDelete).reduce((sum, s) => sum + s.size, 0);
  const score = computeHealthScore({
    zombieRate: neverUsed.length / Math.max(1, merged.length),
    dupGroups: dupEntities.length,
    idleMcp: idleMcp.length,
    logBytes: sessionBytes,
  });
  const riskReport = collectRisks({ catalog, merged, usage, sessions, lang });
  const graph = buildKnowledgeGraph(catalog, usage);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    scannedAt: catalog.scannedAt || null,
    health: {
      score,
      skills: merged.length,
      mcpServers: new Set((catalog.mcpServers || []).map((m) => m.name)).size,
      neverUsed: neverUsed.length,
      duplicateInstalls: dupEntities.length,
      idleMcp,
      unobservableMcp,
      sessionBytes,
      reclaimableBytes: reclaimBytes,
    },
    risks: riskReport.items,
    usage: {
      observedSince: usage.earliest || null,
      topUsed: used.slice(0, 10).map(({ skill, usage: u }) => ({
        dirName: skill.dirName,
        category: skill.category,
        tools: skill.tools,
        count: u.count,
        lastUsed: u.lastUsed,
      })),
      topContext: [...merged]
        .sort((a, b) => (b.descTokens || 0) - (a.descTokens || 0))
        .slice(0, 10)
        .map((skill) => ({
          dirName: skill.dirName,
          category: skill.category,
          tools: skill.tools,
          descTokens: skill.descTokens || 0,
          usageCount: usageOf(skill).count,
        })),
    },
    sessions: summarizeSessions(sessions).slice(0, 10),
    graph: {
      stats: graph.stats,
      edgeTypes: graph.stats.edgeTypes,
    },
    commands: {
      refresh: 'skm scan',
      recommend: 'skm ask "what you want to do"',
      risks: 'skm risks',
      audit: 'skm audit',
      graph: 'skm graph --format html --output skill-graph.html',
      cleanupPlan: 'skm sessions --clean --days 30 --keep 3 --dry-run',
    },
  };
}

function printReportSummary(data, lang) {
  const width = Math.min(termWidth(), 90);
  console.log(`${paint.bold(tr(lang, 'report.title'))}\n`);
  console.log(renderTable(
    [{ title: tr(lang, 'report.col.item'), width: 24 }, { title: tr(lang, 'report.col.value'), width: 0 }],
    [
      [tr(lang, 'report.score'), `${data.health.score} / 100`],
      [tr(lang, 'report.skills'), data.health.skills],
      [tr(lang, 'report.mcp'), data.health.mcpServers],
      [tr(lang, 'report.neverUsed'), data.health.neverUsed],
      [tr(lang, 'report.duplicates'), data.health.duplicateInstalls],
      [tr(lang, 'report.sessions'), fmtBytes(data.health.sessionBytes)],
      [tr(lang, 'report.reclaim'), fmtBytes(data.health.reclaimableBytes)],
      [tr(lang, 'report.scannedAt'), fmtDateTime(data.scannedAt)],
    ],
    width,
  ));
  console.log(`\n${tr(lang, 'report.command')}: skm report --format html --output skm-report.html`);
}

export function renderReportHtml(data, lang = 'zh-CN') {
  const labels = {
    title: tr(lang, 'report.title'),
    generatedAt: tr(lang, 'report.generatedAt'),
    scannedAt: tr(lang, 'report.scannedAt'),
    health: tr(lang, 'report.health'),
    risks: tr(lang, 'report.risks'),
    usage: tr(lang, 'report.usage'),
    sessions: tr(lang, 'report.sessions'),
    graph: tr(lang, 'report.graph'),
    recommend: tr(lang, 'report.recommend'),
    recommendHint: tr(lang, 'report.recommendHint'),
    command: tr(lang, 'report.command'),
    topUsed: tr(lang, 'report.topUsed'),
    topContext: tr(lang, 'report.topContext'),
    riskRows: tr(lang, 'report.riskRows'),
    sessionRows: tr(lang, 'report.sessionRows'),
    graphSummary: tr(lang, 'report.graphSummary'),
  };
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(labels.title)}</title>
<style>
  :root { color-scheme: light; --ink:#111827; --muted:#64748b; --line:#d7dee8; --soft:#f8fafc; --panel:#ffffff; --accent:#2563eb; --good:#059669; --warn:#d97706; --bad:#dc2626; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); background:#eef2f7; }
  header { padding:28px 32px 18px; background:#0f172a; color:#f8fafc; }
  h1 { margin:0 0 8px; font-size:28px; letter-spacing:0; }
  .meta { color:#cbd5e1; font-size:13px; }
  main { max-width:1180px; margin:0 auto; padding:22px; }
  .grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
  .card h2 { margin:0 0 12px; font-size:17px; }
  .metric b { display:block; font-size:28px; line-height:1.1; }
  .metric span { color:var(--muted); font-size:12px; }
  .score { color:${data.health.score >= 80 ? 'var(--good)' : data.health.score >= 60 ? 'var(--warn)' : 'var(--bad)'}; }
  .wide { grid-column: span 2; }
  .full { grid-column: 1 / -1; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
  th { color:#475569; font-weight:650; background:#f8fafc; }
  code { background:#eef2ff; color:#1e3a8a; border-radius:6px; padding:2px 5px; }
  .pill { display:inline-block; padding:2px 7px; border-radius:999px; background:#e2e8f0; color:#334155; font-size:12px; }
  .level-high { color:var(--bad); font-weight:700; }
  .level-medium { color:var(--warn); font-weight:700; }
  .level-low { color:#0891b2; font-weight:700; }
  .level-info { color:#64748b; font-weight:700; }
  .bars { display:grid; gap:8px; }
  .bar { display:grid; grid-template-columns:150px 1fr 44px; gap:8px; align-items:center; font-size:13px; }
  .track { height:9px; border-radius:999px; background:#e2e8f0; overflow:hidden; }
  .fill { height:100%; background:var(--accent); border-radius:999px; }
  @media (max-width:860px) { .grid { grid-template-columns:1fr 1fr; } .wide { grid-column:1 / -1; } }
  @media (max-width:560px) { main { padding:12px; } .grid { grid-template-columns:1fr; } header { padding:22px 16px; } }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(labels.title)}</h1>
  <div class="meta">${escapeHtml(labels.generatedAt)}: ${escapeHtml(fmtDateTime(data.generatedAt))} · ${escapeHtml(labels.scannedAt)}: ${escapeHtml(fmtDateTime(data.scannedAt))}</div>
</header>
<main>
  <section class="grid">
    ${metricCard(tr(lang, 'report.score'), `${data.health.score} / 100`, 'score')}
    ${metricCard(tr(lang, 'report.skills'), data.health.skills)}
    ${metricCard(tr(lang, 'report.mcp'), data.health.mcpServers)}
    ${metricCard(tr(lang, 'report.neverUsed'), data.health.neverUsed)}
    ${metricCard(tr(lang, 'report.duplicates'), data.health.duplicateInstalls)}
    ${metricCard(tr(lang, 'report.sessions'), fmtBytes(data.health.sessionBytes))}
    ${metricCard(tr(lang, 'report.reclaim'), fmtBytes(data.health.reclaimableBytes))}
    ${metricCard(tr(lang, 'report.graph'), `${data.graph.stats.skills} / ${data.graph.stats.edges}`)}

    <article class="card wide">
      <h2>${escapeHtml(labels.recommend)}</h2>
      <p>${escapeHtml(labels.recommendHint)}</p>
      <p><b>${escapeHtml(labels.command)}:</b> <code>${escapeHtml(data.commands.recommend)}</code></p>
      <p><code>${escapeHtml(data.commands.risks)}</code> <code>${escapeHtml(data.commands.audit)}</code> <code>${escapeHtml(data.commands.cleanupPlan)}</code></p>
    </article>

    <article class="card wide">
      <h2>${escapeHtml(labels.graphSummary)}</h2>
      ${renderBars(data.graph.edgeTypes, lang)}
      <p><b>${escapeHtml(tr(lang, 'report.openGraph'))}:</b> <code>${escapeHtml(data.commands.graph)}</code></p>
    </article>

    <article class="card wide">
      <h2>${escapeHtml(labels.riskRows)}</h2>
      ${riskTable(data.risks, lang)}
    </article>

    <article class="card wide">
      <h2>${escapeHtml(labels.topUsed)}</h2>
      ${usageTable(data.usage.topUsed, lang)}
    </article>

    <article class="card wide">
      <h2>${escapeHtml(labels.topContext)}</h2>
      ${contextTable(data.usage.topContext, lang)}
    </article>

    <article class="card wide">
      <h2>${escapeHtml(labels.sessionRows)}</h2>
      ${sessionTable(data.sessions, lang)}
    </article>
  </section>
</main>
</body>
</html>`;
}

function metricCard(label, value, cls = '') {
  return `<article class="card metric"><b class="${cls}">${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></article>`;
}

function riskTable(items, lang) {
  const rows = items.filter((i) => i.severity !== 'ok').slice(0, 8);
  if (!rows.length) return `<p>${escapeHtml(tr(lang, 'common.none'))}</p>`;
  return `<table><thead><tr><th>${escapeHtml(tr(lang, 'report.col.level'))}</th><th>${escapeHtml(tr(lang, 'report.col.name'))}</th><th>${escapeHtml(tr(lang, 'report.col.value'))}</th><th>${escapeHtml(tr(lang, 'report.col.suggestion'))}</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="level-${escapeHtml(r.severity)}">${escapeHtml(tr(lang, `risk.severity.${r.severity}`))}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.count)}</td><td>${escapeHtml(r.suggestion)}</td></tr>`).join('')}</tbody></table>`;
}

function usageTable(rows, lang) {
  if (!rows.length) return `<p>${escapeHtml(tr(lang, 'report.noUsage'))}</p>`;
  return `<table><thead><tr><th>${escapeHtml(tr(lang, 'report.col.name'))}</th><th>${escapeHtml(tr(lang, 'report.col.count'))}</th><th>${escapeHtml(tr(lang, 'report.col.lastUsed'))}</th><th>${escapeHtml(tr(lang, 'report.col.category'))}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.dirName)}</td><td>${r.count}</td><td>${escapeHtml(fmtAgoLang(lang, r.lastUsed))}</td><td>${escapeHtml(r.category)}</td></tr>`).join('')}</tbody></table>`;
}

function contextTable(rows, lang) {
  return `<table><thead><tr><th>${escapeHtml(tr(lang, 'report.col.name'))}</th><th>token</th><th>${escapeHtml(tr(lang, 'report.col.count'))}</th><th>${escapeHtml(tr(lang, 'report.col.category'))}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.dirName)} <span class="pill">${escapeHtml(localizedToolLabel(r.tools, lang))}</span></td><td>${r.descTokens}</td><td>${r.usageCount}</td><td>${escapeHtml(r.category)}</td></tr>`).join('')}</tbody></table>`;
}

function sessionTable(rows, lang) {
  if (!rows.length) return `<p>${escapeHtml(tr(lang, 'common.none'))}</p>`;
  return `<table><thead><tr><th>${escapeHtml(tr(lang, 'report.col.workspace'))}</th><th>${escapeHtml(tr(lang, 'report.col.count'))}</th><th>${escapeHtml(tr(lang, 'report.col.size'))}</th><th>${escapeHtml(tr(lang, 'sessions.col.newest'))}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.workspace ?? tr(lang, 'sessions.unknownWorkspace'))}</td><td>${r.count}</td><td>${escapeHtml(fmtBytes(r.bytes))}</td><td>${escapeHtml(fmtDay(r.newest))}</td></tr>`).join('')}</tbody></table>`;
}

function renderBars(edgeTypes, lang) {
  const entries = Object.entries(edgeTypes || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!entries.length) return `<p>${escapeHtml(tr(lang, 'common.none'))}</p>`;
  const max = Math.max(...entries.map(([, n]) => n));
  return `<div class="bars">${entries.map(([type, n]) => `<div class="bar"><span>${escapeHtml(edgeName(type, lang))}</span><div class="track"><div class="fill" style="width:${Math.max(4, Math.round((n / max) * 100))}%"></div></div><b>${n}</b></div>`).join('')}</div>`;
}

function summarizeSessions(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.workspace ?? null;
    const row = map.get(key) || { workspace: key, count: 0, bytes: 0, newest: 0 };
    row.count++;
    row.bytes += s.size;
    row.newest = Math.max(row.newest, s.mtimeMs);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

function inferFormat(output) {
  const ext = path.extname(output).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.json') return 'json';
  return 'summary';
}

function writeTextFile(file, text) {
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
}

function localizedToolLabel(tools, lang) {
  const label = toolLabel(tools);
  return label === '两侧' ? tr(lang, 'tool.both') : label;
}

function edgeName(type, lang) {
  const en = {
    same_family: 'same family',
    same_category: 'same category',
    duplicate: 'duplicate',
    alternative: 'alternative',
    pipeline: 'workflow',
    reverse_transform: 'reverse conversion',
    shared_platform: 'shared platform',
    uses_mcp: 'uses MCP',
  };
  const zh = {
    same_family: '同源',
    same_category: '同类',
    duplicate: '重复',
    alternative: '替代',
    pipeline: '流程',
    reverse_transform: '反向转换',
    shared_platform: '共享平台',
    uses_mcp: '使用 MCP',
  };
  return (lang === 'en' ? en : zh)[type] || type;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
