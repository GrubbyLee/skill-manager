import { mergeByDirName, isDupEntity } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { buildSessionIndex, planClean } from '../sessionsIndex.js';
import { findIdleMcp } from '../advice.js';
import { ensureCatalog } from './scan.js';
import { fmtBytes, paint } from '../utils.js';
import { renderTable, termWidth } from '../table.js';
import { fmtAgoLang, tr } from '../i18n.js';

const HIGH_CONTEXT_TOKENS = 180;
const STALE_DAYS = 90;
const LARGE_LOG_BYTES = 1e9;
const RECLAIM_HINT_BYTES = 50e6;

// skm risks：AIDE 只读风险清单。不会修改 Claude/Codex 的 skill、MCP、配置或会话日志；
// 但会复用使用统计与会话索引，可能更新 ~/.skill-manager 下的 skm 自身缓存。
export function runRisks({ cwd, json = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(catalog.skills);
  if (!merged.length) {
    if (json) {
      console.log(JSON.stringify({
        generatedAt: new Date().toISOString(),
        scannedAt: catalog.scannedAt || null,
        score: 100,
        summary: { skills: 0, mcpServers: new Set((catalog.mcpServers || []).map((m) => m.name)).size, high: 0, medium: 0, low: 0, info: 0 },
        items: [],
      }, null, 2));
      return;
    }
    console.log(tr(lang, 'risks.empty'));
    return;
  }

  console.error(tr(lang, 'risks.loading'));
  const usage = scanUsage({ log: (msg) => console.error(msg) });
  const sessions = buildSessionIndex();
  const report = collectRisks({ catalog, merged, usage, sessions, lang: json ? 'zh-CN' : lang });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const color = report.score >= 80 ? paint.green : report.score >= 60 ? paint.yellow : paint.red;
  console.log(paint.bold(tr(lang, 'risks.title', { score: color(`${report.score} / 100`) })) + '\n');
  console.log(renderTable(
    [{ title: tr(lang, 'risks.col.severity'), width: 8 }, { title: tr(lang, 'risks.col.item'), width: 28 }, { title: tr(lang, 'risks.col.count'), width: 8 }, { title: tr(lang, 'risks.col.suggestion'), width: 0 }],
    report.items.map((item) => [severityLabel(item.severity, lang), item.title, item.count, item.suggestion]),
    termWidth(),
  ));

  for (const item of report.items.filter((x) => x.samples.length)) {
    console.log(`\n${severityLabel(item.severity, lang)} ${item.title}`);
    for (const sample of item.samples) console.log(`  - ${sample}`);
    if (item.more > 0) console.log(`  ${tr(lang, 'risks.more', { count: item.more })}`);
  }

  console.log(`\n${tr(lang, 'risks.note')}`);
}

export function collectRisks({ catalog, merged = mergeByDirName(catalog.skills), usage, sessions = [], lang = 'zh-CN' }) {
  const usageOf = buildUsageLookup(merged, usage);
  const rows = merged.map((m) => ({ skill: m, usage: usageOf(m) }));
  const dupEntities = merged.filter(isDupEntity);
  const neverUsed = rows.filter((r) => r.usage.count === 0);
  const duplicateAndNeverUsed = neverUsed.filter((r) => isDupEntity(r.skill));
  const highContextNeverUsed = neverUsed
    .filter((r) => (r.skill.descTokens || 0) >= HIGH_CONTEXT_TOKENS)
    .sort((a, b) => (b.skill.descTokens || 0) - (a.skill.descTokens || 0));
  const now = Date.now();
  const stale = rows
    .filter((r) => r.usage.count > 0 && r.usage.lastUsed && now - Date.parse(r.usage.lastUsed) > STALE_DAYS * 86400e3)
    .sort((a, b) => Date.parse(a.usage.lastUsed) - Date.parse(b.usage.lastUsed));
  const missingDescription = merged.filter((m) => !String(m.description || '').trim());
  const { idle: idleMcp, unobservable: codexOnlyMcp } = findIdleMcp(catalog.mcpServers || [], usage);
  const sessionBytes = sessions.reduce((sum, s) => sum + s.size, 0);
  const cleanPlan = planClean(sessions, { keep: 3, days: 30 });
  const reclaimBytes = cleanPlan.groups.flatMap((g) => g.toDelete).reduce((sum, s) => sum + s.size, 0);

  const items = [];
  addItem(items, {
    severity: duplicateAndNeverUsed.length ? 'high' : 'ok',
    title: riskText(lang, 'duplicateNeverUsed'),
    count: duplicateAndNeverUsed.length,
    suggestion: duplicateAndNeverUsed.length ? riskSuggestion(lang, 'duplicateNeverUsed', duplicateAndNeverUsed.slice(0, 3).map((r) => r.skill.dirName).join(' ')) : tr(lang, 'common.none'),
    samples: duplicateAndNeverUsed.map((r) => sampleText(lang, 'duplicateNeverUsed', r)),
  });
  addItem(items, {
    severity: dupEntities.length ? 'medium' : 'ok',
    title: riskText(lang, 'duplicateEntity'),
    count: dupEntities.length,
    suggestion: dupEntities.length ? riskSuggestion(lang, 'duplicateEntity') : tr(lang, 'common.none'),
    samples: dupEntities.map((m) => sampleText(lang, 'duplicateEntity', m)),
  });
  addItem(items, {
    severity: highContextNeverUsed.length ? 'medium' : 'ok',
    title: riskText(lang, 'highContextNeverUsed'),
    count: highContextNeverUsed.length,
    suggestion: highContextNeverUsed.length ? riskSuggestion(lang, 'highContextNeverUsed') : tr(lang, 'common.none'),
    samples: highContextNeverUsed.map((r) => sampleText(lang, 'highContextNeverUsed', r)),
  });
  addItem(items, {
    severity: idleMcp.length ? 'medium' : 'ok',
    title: riskText(lang, 'idleClaudeMcp'),
    count: idleMcp.length,
    suggestion: idleMcp.length ? riskSuggestion(lang, 'idleClaudeMcp', idleMcp.join(' ')) : tr(lang, 'common.none'),
    samples: idleMcp,
  });
  addItem(items, {
    severity: sessionBytes > LARGE_LOG_BYTES ? 'medium' : reclaimBytes > RECLAIM_HINT_BYTES ? 'low' : 'ok',
    title: riskText(lang, 'sessionLogSize'),
    count: fmtBytes(sessionBytes),
    suggestion: reclaimBytes > 0 ? riskSuggestion(lang, 'sessionLogSize', fmtBytes(reclaimBytes)) : riskSuggestion(lang, 'sessionLogNoReclaim'),
    samples: sessionBytes ? [sampleText(lang, 'sessionLogSize', { sessionBytes, reclaimBytes })] : [],
  });
  addItem(items, {
    severity: stale.length ? 'low' : 'ok',
    title: riskText(lang, 'stale', STALE_DAYS),
    count: stale.length,
    suggestion: stale.length ? riskSuggestion(lang, 'stale') : tr(lang, 'common.none'),
    samples: stale.map((r) => sampleText(lang, 'stale', r)),
  });
  addItem(items, {
    severity: missingDescription.length ? 'low' : 'ok',
    title: riskText(lang, 'missingDescription'),
    count: missingDescription.length,
    suggestion: missingDescription.length ? riskSuggestion(lang, 'missingDescription') : tr(lang, 'common.none'),
    samples: missingDescription.map((m) => m.dirName),
  });
  addItem(items, {
    severity: codexOnlyMcp.length ? 'info' : 'ok',
    title: riskText(lang, 'codexOnlyMcp'),
    count: codexOnlyMcp.length,
    suggestion: codexOnlyMcp.length ? riskSuggestion(lang, 'codexOnlyMcp') : tr(lang, 'common.none'),
    samples: codexOnlyMcp,
  });

  const score = computeRiskScore(items);
  return {
    generatedAt: new Date().toISOString(),
    scannedAt: catalog.scannedAt || null,
    score,
    summary: {
      skills: merged.length,
      mcpServers: new Set((catalog.mcpServers || []).map((m) => m.name)).size,
      high: items.filter((i) => i.severity === 'high').length,
      medium: items.filter((i) => i.severity === 'medium').length,
      low: items.filter((i) => i.severity === 'low').length,
      info: items.filter((i) => i.severity === 'info').length,
    },
    items,
  };
}

function addItem(items, item) {
  const samples = item.samples || [];
  items.push({
    severity: item.severity,
    title: item.title,
    count: item.count,
    suggestion: item.suggestion,
    samples: samples.slice(0, 8),
    more: Math.max(0, samples.length - 8),
  });
}

function computeRiskScore(items) {
  let score = 100;
  for (const item of items) {
    if (item.severity === 'high') score -= 18;
    if (item.severity === 'medium') score -= 9;
    if (item.severity === 'low') score -= 3;
  }
  return Math.max(0, score);
}

function severityLabel(severity, lang = 'zh-CN') {
  if (severity === 'high') return paint.red(tr(lang, 'risk.severity.high'));
  if (severity === 'medium') return paint.yellow(tr(lang, 'risk.severity.medium'));
  if (severity === 'low') return paint.cyan(tr(lang, 'risk.severity.low'));
  if (severity === 'info') return paint.gray(tr(lang, 'risk.severity.info'));
  return paint.green(tr(lang, 'risk.severity.ok'));
}

function riskText(lang, key, value) {
  const en = {
    duplicateNeverUsed: 'Duplicate and never used',
    duplicateEntity: 'Duplicate physical installs',
    highContextNeverUsed: 'High context cost and never used',
    idleClaudeMcp: 'Idle Claude-side MCP',
    sessionLogSize: 'Session log size',
    stale: `Unused for ${value}+ days`,
    missingDescription: 'Missing description',
    codexOnlyMcp: 'Codex-only MCP',
  };
  const zh = {
    duplicateNeverUsed: '双份且从未使用',
    duplicateEntity: '实体双份安装',
    highContextNeverUsed: '高上下文开销且未使用',
    idleClaudeMcp: 'Claude 侧闲置 MCP',
    sessionLogSize: '会话日志体积',
    stale: `${value} 天以上未用`,
    missingDescription: 'description 缺失',
    codexOnlyMcp: '仅 Codex 侧 MCP',
  };
  return (lang === 'en' ? en : zh)[key];
}

function riskSuggestion(lang, key, value = '') {
  const en = {
    duplicateNeverUsed: `Review skm audit and skm dupes first, then consider skm disable ${value}`,
    duplicateEntity: 'Run skm dupes to inspect symlink sharing, same-content copies, and divergent duplicates',
    highContextNeverUsed: 'Prioritize skills with long descriptions that have never been used',
    idleClaudeMcp: `If confirmed unused, consider skm disable --mcp ${value}`,
    sessionLogSize: `Run skm sessions --clean --days 30 --keep 3 --dry-run first (estimated reclaim ${value})`,
    sessionLogNoReclaim: 'No obvious cleanup space',
    stale: 'Use skm audit to decide whether to archive or disable them',
    missingDescription: 'Add SKILL.md frontmatter descriptions to improve search, recommendation, and graph quality',
    codexOnlyMcp: 'Currently unobservable from Claude logs; skm does not recommend disabling them based on this alone',
  };
  const zh = {
    duplicateNeverUsed: `先核对 skm audit 与 skm dupes，再考虑 skm disable ${value}`,
    duplicateEntity: '运行 skm dupes 查看软链共享、同内容复制与内容不同的明细',
    highContextNeverUsed: '优先审查 description 很长且从未使用的 skill',
    idleClaudeMcp: `确认不用后可 skm disable --mcp ${value}`,
    sessionLogSize: `先运行 skm sessions --clean --days 30 --keep 3 --dry-run（预计可释放 ${value}）`,
    sessionLogNoReclaim: '无明显清理空间',
    stale: '结合 skm audit 判断是否归档或禁用',
    missingDescription: '补齐 SKILL.md frontmatter description，可提升搜索、推荐和图谱质量',
    codexOnlyMcp: '当前无法从 Claude 日志观测，不据此建议禁用',
  };
  return (lang === 'en' ? en : zh)[key];
}

function sampleText(lang, key, value) {
  if (lang === 'en') {
    if (key === 'duplicateNeverUsed') return `${value.skill.dirName} (${value.skill.tools.join(' + ')}, about ${value.skill.descTokens || 0} tokens)`;
    if (key === 'duplicateEntity') return `${value.dirName} (${value.entries.length} install locations)`;
    if (key === 'highContextNeverUsed') return `${value.skill.dirName} (about ${value.skill.descTokens || 0} tokens)`;
    if (key === 'sessionLogSize') return `Total ${fmtBytes(value.sessionBytes)}, 30 days ∪ keep 3 can reclaim ${fmtBytes(value.reclaimBytes)}`;
    if (key === 'stale') return `${value.skill.dirName} (last used ${fmtAgoLang(lang, value.usage.lastUsed)}, used ${value.usage.count} time(s))`;
  }
  if (key === 'duplicateNeverUsed') return `${value.skill.dirName}（${value.skill.tools.join(' + ')}，约 ${value.skill.descTokens || 0} token）`;
  if (key === 'duplicateEntity') return `${value.dirName}（${value.entries.length} 处安装）`;
  if (key === 'highContextNeverUsed') return `${value.skill.dirName}（约 ${value.skill.descTokens || 0} token）`;
  if (key === 'sessionLogSize') return `总量 ${fmtBytes(value.sessionBytes)}，按 30 天 ∪ 留 3 个策略可释放 ${fmtBytes(value.reclaimBytes)}`;
  if (key === 'stale') return `${value.skill.dirName}（最近 ${fmtAgoLang(lang, value.usage.lastUsed)}，用过 ${value.usage.count} 次）`;
  return String(value);
}
