import { mergeByDirName, isDupEntity } from './catalog.js';
import { buildUsageLookup } from './usage.js';
import { planClean } from './sessionsIndex.js';
import { buildCleanupTips, findIdleMcp } from './advice.js';
import { collectRisks } from './commands/risks.js';
import { computeHealthScore } from './health.js';
import { missingSourceRows } from './sources.js';
import { fmtBytes, paint } from './utils.js';
import { fmtAgoLang, tr } from './i18n.js';
import { renderTable, termWidth } from './table.js';

const STALE_DAYS = 90;

export function buildOverview({ catalog, usage, sessions = [], lang = 'zh-CN' }) {
  const merged = mergeByDirName(catalog.skills || []);
  const usageOf = buildUsageLookup(merged, usage);
  const rows = merged.map((skill) => ({ skill, usage: usageOf(skill) }));
  const neverUsed = rows.filter((row) => row.usage.count === 0);
  const dupEntities = merged.filter(isDupEntity);
  const both = merged.filter((skill) => (skill.tools || []).length > 1).length;
  const { idle: idleMcp, unobservable: unobservableMcp } = findIdleMcp(catalog.mcpServers || [], usage);
  const { tips, primary } = buildCleanupTips({ merged, usageOf, idleMcp });
  const cleanPlan = planClean(sessions, { keep: 3, days: 30 });
  const sessionBytes = sessions.reduce((sum, session) => sum + session.size, 0);
  const reclaimBytes = cleanPlan.groups.flatMap((group) => group.toDelete).reduce((sum, session) => sum + session.size, 0);
  const score = computeHealthScore({
    zombieRate: neverUsed.length / Math.max(1, merged.length),
    dupGroups: dupEntities.length,
    idleMcp: idleMcp.length,
    logBytes: sessionBytes,
  });
  const securitySummary = catalog.security?.summary || { high: 0, medium: 0, low: 0, info: 0 };
  const risks = merged.length ? collectRisks({ catalog, merged, usage, sessions, lang }) : emptyRisks(catalog);
  const updates = summarizeVersionStatus(merged);
  const sourceMissing = missingSourceRows(merged);
  const mcpNames = [...new Set((catalog.mcpServers || []).map((server) => server.name))];
  const topCategories = summarizeCategories(merged).slice(0, 5);
  const stale = countStaleRows(rows);

  return {
    generatedAt: new Date().toISOString(),
    scannedAt: catalog.scannedAt || null,
    score,
    skills: merged.length,
    mcpServers: mcpNames.length,
    zombies: neverUsed.length,
    zombieRate: Number((neverUsed.length / Math.max(1, merged.length)).toFixed(2)),
    dupEntities: dupEntities.length,
    idleMcp,
    unobservableMcp,
    sessionBytes,
    reclaimableBytes: reclaimBytes,
    primaryCleanTargets: primary,
    domains: {
      inventory: {
        skills: merged.length,
        mcpServers: mcpNames.length,
        sameNameBoth: both,
        topCategories,
        warnings: (catalog.warnings || []).length,
        commands: ['skm list', 'skm list --mcp', 'skm scan --verbose'],
      },
      risks: {
        score: risks.score,
        high: risks.summary.high,
        medium: risks.summary.medium,
        low: risks.summary.low,
        securitySummary,
        topItems: risks.items.filter((item) => item.severity !== 'ok').slice(0, 3),
        commands: ['skm risks', 'skm audit --json'],
      },
      usage: {
        neverUsed: neverUsed.length,
        stale,
        duplicateNeverUsed: primary.length,
        topUsed: rows.filter((row) => row.usage.count > 0).sort((a, b) => b.usage.count - a.usage.count).slice(0, 3).map(({ skill, usage: u }) => ({ name: skill.dirName, count: u.count })),
        commands: ['skm audit', 'skm state plan', 'skm audit --history'],
      },
      state: {
        candidates: countStateCandidates(rows),
        claudeNative: merged.filter((skill) => (skill.entries || [skill]).some((entry) => entry.tool === 'claude-code' && entry.scope !== 'plugin')).length,
        codexManual: merged.filter((skill) => (skill.entries || [skill]).some((entry) => entry.tool === 'codex')).length,
        commands: ['skm state plan', 'skm state list'],
      },
      versions: {
        outdated: 0,
        unchecked: updates.checkable,
        unknown: updates.unknown,
        untracked: updates.untracked,
        sourceMissing: sourceMissing.length,
        commands: ['skm outdated --online', 'skm sources missing', 'skm sources wizard'],
      },
      duplicates: {
        dupEntities: dupEntities.length,
        sameNameBoth: both,
        duplicateNeverUsed: primary.length,
        commands: ['skm dupes', primary.length ? `skm disable ${primary.slice(0, 3).join(' ')}` : 'skm dupes --json'],
      },
      graph: {
        skills: merged.length,
        mcpServers: mcpNames.length,
        commands: ['skm graph --format html --output skill-graph.html'],
      },
      sessions: {
        sessionBytes,
        reclaimBytes,
        workspaces: new Set(sessions.map((session) => session.workspace).filter(Boolean)).size,
        commands: ['skm sessions', 'skm sessions --clean --days 30 --keep 3 --dry-run'],
      },
      recommendation: {
        commands: ['skm ask "what you want to do"', 'skm recommend "task" --why'],
      },
      cleanupTips: tips,
      idleMcp,
      unobservableMcp,
    },
  };
}

export function renderOverview(data, lang = 'zh-CN') {
  const width = Math.min(termWidth(), 110);
  const scorePaint = data.score >= 80 ? paint.green : data.score >= 60 ? paint.yellow : paint.red;
  const rows = [
    domainRow(lang, 'overview.domain.inventory', inventorySummary(data, lang), inventoryProblem(data, lang), data.domains.inventory.commands),
    domainRow(lang, 'overview.domain.risks', risksSummary(data, lang), risksProblem(data, lang), data.domains.risks.commands),
    domainRow(lang, 'overview.domain.usage', usageSummary(data, lang), usageProblem(data, lang), data.domains.usage.commands),
    domainRow(lang, 'overview.domain.state', stateSummary(data, lang), stateProblem(data, lang), data.domains.state.commands),
    domainRow(lang, 'overview.domain.versions', versionSummary(data, lang), versionProblem(data, lang), data.domains.versions.commands),
    domainRow(lang, 'overview.domain.duplicates', duplicateSummary(data, lang), duplicateProblem(data, lang), data.domains.duplicates.commands),
    domainRow(lang, 'overview.domain.graph', graphSummary(data, lang), graphProblem(data, lang), data.domains.graph.commands),
    domainRow(lang, 'overview.domain.sessions', sessionSummary(data, lang), sessionProblem(data, lang), data.domains.sessions.commands),
    domainRow(lang, 'overview.domain.recommendation', tr(lang, 'overview.recommendation.summary'), tr(lang, 'overview.recommendation.problem'), data.domains.recommendation.commands),
  ];

  const lines = [];
  lines.push(paint.bold(tr(lang, 'overview.title', { ago: fmtAgoLang(lang, data.scannedAt), score: scorePaint(`${data.score} / 100`) })));
  lines.push('');
  lines.push(renderTable(
    [
      { title: tr(lang, 'overview.col.domain'), width: 18 },
      { title: tr(lang, 'overview.col.summary'), width: 30 },
      { title: tr(lang, 'overview.col.problem'), width: 28 },
      { title: tr(lang, 'overview.col.next'), width: 0 },
    ],
    rows,
    width,
  ));
  lines.push('');
  lines.push(paint.bold(tr(lang, 'overview.priority')));
  for (const line of priorityLines(data, lang).slice(0, 5)) lines.push(`  - ${line}`);
  lines.push('');
  lines.push(tr(lang, 'overview.drilldown'));
  return lines.join('\n');
}

function domainRow(lang, key, summary, problem, commands) {
  return [tr(lang, key), summary, problem, commands.filter(Boolean).join(' | ')];
}

function inventorySummary(data, lang) {
  const d = data.domains.inventory;
  return tr(lang, 'overview.inventory.summary', { skills: d.skills, mcp: d.mcpServers, both: d.sameNameBoth });
}

function inventoryProblem(data, lang) {
  const d = data.domains.inventory;
  if (d.warnings) return tr(lang, 'overview.inventory.warningProblem', { count: d.warnings });
  if (d.topCategories.length) return d.topCategories.map((item) => `${item.category} ${item.count}`).join(', ');
  return tr(lang, 'common.none');
}

function risksSummary(data, lang) {
  const d = data.domains.risks;
  return tr(lang, 'overview.risks.summary', { high: d.high, medium: d.medium, low: d.low });
}

function risksProblem(data, lang) {
  const sec = data.domains.risks.securitySummary;
  if (sec.high || sec.medium || sec.low) return tr(lang, 'overview.risks.securityProblem', { high: sec.high, medium: sec.medium, low: sec.low });
  return data.domains.risks.topItems.map((item) => `${item.title}: ${item.count}`).join('\n') || tr(lang, 'common.none');
}

function usageSummary(data, lang) {
  const d = data.domains.usage;
  return tr(lang, 'overview.usage.summary', { neverUsed: d.neverUsed, stale: d.stale });
}

function usageProblem(data, lang) {
  const d = data.domains.usage;
  if (d.duplicateNeverUsed) return tr(lang, 'overview.usage.duplicateProblem', { count: d.duplicateNeverUsed });
  if (d.topUsed.length) return d.topUsed.map((item) => `${item.name} x${item.count}`).join(', ');
  return tr(lang, 'common.none');
}

function stateSummary(data, lang) {
  const d = data.domains.state;
  return tr(lang, 'overview.state.summary', { candidates: d.candidates, claude: d.claudeNative, codex: d.codexManual });
}

function stateProblem(data, lang) {
  const d = data.domains.state;
  if (d.candidates) return tr(lang, 'overview.state.problem', { count: d.candidates });
  return tr(lang, 'common.none');
}

function versionSummary(data, lang) {
  const d = data.domains.versions;
  return tr(lang, 'overview.versions.summary', { unchecked: d.unchecked, unknown: d.unknown, untracked: d.untracked });
}

function versionProblem(data, lang) {
  const d = data.domains.versions;
  if (d.sourceMissing) return tr(lang, 'overview.versions.sourceProblem', { count: d.sourceMissing });
  if (d.unchecked) return tr(lang, 'overview.versions.checkProblem', { count: d.unchecked });
  return tr(lang, 'common.none');
}

function duplicateSummary(data, lang) {
  const d = data.domains.duplicates;
  return tr(lang, 'overview.duplicates.summary', { dup: d.dupEntities, both: d.sameNameBoth });
}

function duplicateProblem(data, lang) {
  const d = data.domains.duplicates;
  if (d.duplicateNeverUsed) return tr(lang, 'overview.duplicates.cleanupProblem', { count: d.duplicateNeverUsed });
  return d.dupEntities ? tr(lang, 'overview.duplicates.reviewProblem') : tr(lang, 'common.none');
}

function graphSummary(data, lang) {
  const d = data.domains.graph;
  return tr(lang, 'overview.graph.summary', { skills: d.skills, mcp: d.mcpServers });
}

function graphProblem(_data, lang) {
  return tr(lang, 'overview.graph.problem');
}

function sessionSummary(data, lang) {
  const d = data.domains.sessions;
  return tr(lang, 'overview.sessions.summary', { bytes: fmtBytes(d.sessionBytes), workspaces: d.workspaces });
}

function sessionProblem(data, lang) {
  const d = data.domains.sessions;
  return d.reclaimBytes ? tr(lang, 'overview.sessions.reclaimProblem', { bytes: fmtBytes(d.reclaimBytes) }) : tr(lang, 'common.none');
}

function priorityLines(data, lang) {
  const out = [];
  const versions = data.domains.versions;
  const risks = data.domains.risks;
  const usage = data.domains.usage;
  const sessions = data.domains.sessions;
  if (risks.high || risks.medium) out.push(tr(lang, 'overview.priority.risks', { command: 'skm risks' }));
  if (versions.unchecked || versions.sourceMissing) out.push(tr(lang, 'overview.priority.versions', { command: 'skm outdated --online', sources: 'skm sources missing' }));
  if (usage.duplicateNeverUsed || usage.neverUsed) out.push(tr(lang, 'overview.priority.usage', { command: 'skm audit' }));
  if (data.domains.state.candidates) out.push(tr(lang, 'overview.priority.state', { command: 'skm state plan' }));
  if (data.domains.duplicates.dupEntities) out.push(tr(lang, 'overview.priority.dupes', { command: 'skm dupes' }));
  if (sessions.reclaimBytes) out.push(tr(lang, 'overview.priority.sessions', { command: 'skm sessions --clean --days 30 --keep 3 --dry-run' }));
  if (!out.length) out.push(tr(lang, 'overview.priority.ok'));
  return out;
}

function summarizeVersionStatus(merged) {
  let checkable = 0;
  let unknown = 0;
  let untracked = 0;
  for (const skill of merged) {
    const upstream = chooseUpstream(skill.entries || [skill]);
    const hasSource = Boolean(upstream.git?.remote || upstream.source || upstream.repository || upstream.homepage);
    if ((upstream.git?.remote && upstream.git?.head) || hasCheckableSkillMdUrl(upstream)) checkable++;
    else if (hasSource || upstream.version) unknown++;
    else untracked++;
  }
  return { checkable, unknown, untracked };
}

function countStaleRows(rows) {
  const now = Date.now();
  return rows.filter((row) => {
    if (!(row.usage.count > 0) || !row.usage.lastUsed) return false;
    const last = Date.parse(row.usage.lastUsed);
    return Number.isFinite(last) && now - last > STALE_DAYS * 86400e3;
  }).length;
}

function countStateCandidates(rows) {
  return rows.filter((row) => {
    const highContext = Number(row.skill.descTokens || 0) >= 120;
    return row.usage.count === 0 || highContext || isDupEntity(row.skill);
  }).length;
}

function emptyRisks(catalog) {
  return {
    score: 100,
    summary: {
      skills: 0,
      mcpServers: new Set((catalog.mcpServers || []).map((server) => server.name)).size,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
    items: [],
  };
}

function chooseUpstream(entries) {
  for (const entry of entries) {
    const upstream = entry.upstream || {};
    if (upstream.git?.remote || upstream.source || upstream.repository || upstream.homepage) return upstream;
  }
  return entries[0]?.upstream || {};
}

function hasCheckableSkillMdUrl(upstream) {
  return [upstream.source, upstream.repository, upstream.homepage].some((url) => rawSkillMdUrls(url).length > 0);
}

function rawSkillMdUrls(url) {
  if (!url || !/^https?:\/\//i.test(url)) return [];
  let u;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.hostname === 'github.com' && parts.length >= 2) {
    const [, repoRaw, kind, branch, ...rest] = parts;
    if (!repoRaw) return [];
    if ((kind === 'tree' || kind === 'blob') && branch) {
      const filePath = rest.join('/').endsWith('SKILL.md') ? rest.join('/') : [...rest, 'SKILL.md'].join('/');
      return filePath ? [filePath] : [];
    }
    if (!kind) return ['SKILL.md'];
  }
  if (u.hostname === 'gitee.com' && parts.length >= 2) {
    const [, repoRaw, kind, branch, ...rest] = parts;
    if (!repoRaw) return [];
    if ((kind === 'tree' || kind === 'blob') && branch) {
      const filePath = rest.join('/').endsWith('SKILL.md') ? rest.join('/') : [...rest, 'SKILL.md'].join('/');
      return filePath ? [filePath] : [];
    }
    if (!kind) return ['SKILL.md'];
  }
  if (u.pathname.endsWith('/SKILL.md')) return [url];
  return [];
}

function summarizeCategories(merged) {
  const counts = new Map();
  for (const skill of merged) counts.set(skill.category, (counts.get(skill.category) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
}
