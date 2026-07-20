import { mergeByDirName, isDupEntity } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { buildSessionIndex, planClean } from '../sessionsIndex.js';
import { findIdleMcp } from '../advice.js';
import { ensureCatalog } from './scan.js';
import { fmtAgo, fmtBytes, paint } from '../utils.js';
import { renderTable, termWidth } from '../table.js';

const HIGH_CONTEXT_TOKENS = 180;
const STALE_DAYS = 90;
const LARGE_LOG_BYTES = 1e9;
const RECLAIM_HINT_BYTES = 50e6;

// skm risks：AIDE 只读风险清单。不会修改 Claude/Codex 的 skill、MCP、配置或会话日志；
// 但会复用使用统计与会话索引，可能更新 ~/.skill-manager 下的 skm 自身缓存。
export function runRisks({ cwd, json = false }) {
  const catalog = ensureCatalog(cwd);
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
    console.log('目录为空：两侧都没有扫描到 skill，无可评估风险。');
    return;
  }

  console.error('正在汇总风险信号（使用统计、MCP、会话日志）…');
  const usage = scanUsage({ log: (msg) => console.error(msg) });
  const sessions = buildSessionIndex();
  const report = collectRisks({ catalog, merged, usage, sessions });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const color = report.score >= 80 ? paint.green : report.score >= 60 ? paint.yellow : paint.red;
  console.log(paint.bold('skm 风险报告') + `（风险分 ${color(`${report.score} / 100`)}，越高越安全）\n`);
  console.log(renderTable(
    [{ title: '等级', width: 8 }, { title: '风险项', width: 24 }, { title: '数量', width: 8 }, { title: '建议', width: 0 }],
    report.items.map((item) => [severityLabel(item.severity), item.title, item.count, item.suggestion]),
    termWidth(),
  ));

  for (const item of report.items.filter((x) => x.samples.length)) {
    console.log(`\n${severityLabel(item.severity)} ${item.title}`);
    for (const sample of item.samples) console.log(`  - ${sample}`);
    if (item.more > 0) console.log(`  …另有 ${item.more} 项，使用 skm risks --json 查看完整数据`);
  }

  console.log('\n说明：本命令不会修改 Claude/Codex 的 skill、MCP、配置或会话日志；可能更新 ~/.skill-manager 下的 skm 自身缓存。写操作仍需通过 skm disable / skm sessions --clean 并经过确认。');
}

export function collectRisks({ catalog, merged = mergeByDirName(catalog.skills), usage, sessions = [] }) {
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
    title: '双份且从未使用',
    count: duplicateAndNeverUsed.length,
    suggestion: duplicateAndNeverUsed.length ? `先核对 skm audit 与 skm dupes，再考虑 skm disable ${duplicateAndNeverUsed.slice(0, 3).map((r) => r.skill.dirName).join(' ')}` : '无',
    samples: duplicateAndNeverUsed.map((r) => `${r.skill.dirName}（${r.skill.tools.join(' + ')}，约 ${r.skill.descTokens || 0} token）`),
  });
  addItem(items, {
    severity: dupEntities.length ? 'medium' : 'ok',
    title: '实体双份安装',
    count: dupEntities.length,
    suggestion: dupEntities.length ? '运行 skm dupes 查看软链共享、同内容复制与内容不同的明细' : '无',
    samples: dupEntities.map((m) => `${m.dirName}（${m.entries.length} 处安装）`),
  });
  addItem(items, {
    severity: highContextNeverUsed.length ? 'medium' : 'ok',
    title: '高上下文开销且未使用',
    count: highContextNeverUsed.length,
    suggestion: highContextNeverUsed.length ? '优先审查 description 很长且从未使用的 skill' : '无',
    samples: highContextNeverUsed.map((r) => `${r.skill.dirName}（约 ${r.skill.descTokens || 0} token）`),
  });
  addItem(items, {
    severity: idleMcp.length ? 'medium' : 'ok',
    title: 'Claude 侧闲置 MCP',
    count: idleMcp.length,
    suggestion: idleMcp.length ? `确认不用后可 skm disable --mcp ${idleMcp.join(' ')}` : '无',
    samples: idleMcp,
  });
  addItem(items, {
    severity: sessionBytes > LARGE_LOG_BYTES ? 'medium' : reclaimBytes > RECLAIM_HINT_BYTES ? 'low' : 'ok',
    title: '会话日志体积',
    count: fmtBytes(sessionBytes),
    suggestion: reclaimBytes > 0 ? `先运行 skm sessions --clean --days 30 --keep 3 --dry-run（预计可释放 ${fmtBytes(reclaimBytes)}）` : '无明显清理空间',
    samples: sessionBytes ? [`总量 ${fmtBytes(sessionBytes)}，按 30 天 ∪ 留 3 个策略可释放 ${fmtBytes(reclaimBytes)}`] : [],
  });
  addItem(items, {
    severity: stale.length ? 'low' : 'ok',
    title: `${STALE_DAYS} 天以上未用`,
    count: stale.length,
    suggestion: stale.length ? '结合 skm audit 判断是否归档或禁用' : '无',
    samples: stale.map((r) => `${r.skill.dirName}（最近 ${fmtAgo(r.usage.lastUsed)}，用过 ${r.usage.count} 次）`),
  });
  addItem(items, {
    severity: missingDescription.length ? 'low' : 'ok',
    title: 'description 缺失',
    count: missingDescription.length,
    suggestion: missingDescription.length ? '补齐 SKILL.md frontmatter description，可提升搜索、推荐和图谱质量' : '无',
    samples: missingDescription.map((m) => m.dirName),
  });
  addItem(items, {
    severity: codexOnlyMcp.length ? 'info' : 'ok',
    title: '仅 Codex 侧 MCP',
    count: codexOnlyMcp.length,
    suggestion: codexOnlyMcp.length ? '当前无法从 Claude 日志观测，不据此建议禁用' : '无',
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

function severityLabel(severity) {
  if (severity === 'high') return paint.red('高');
  if (severity === 'medium') return paint.yellow('中');
  if (severity === 'low') return paint.cyan('低');
  if (severity === 'info') return paint.gray('信息');
  return paint.green('正常');
}
