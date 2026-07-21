import { mergeByDirName, isDupEntity } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { buildSessionIndex, planClean } from '../sessionsIndex.js';
import { buildCleanupTips, findIdleMcp } from '../advice.js';
import { ensureCatalog } from './scan.js';
import { pad } from '../table.js';
import { paint, fmtBytes } from '../utils.js';
import { fmtAgoLang, tr } from '../i18n.js';

// skm 裸命令 = 一屏健康体检：总量 / 僵尸率 / 重复 / 会话体积 / 健康分 + 可直接执行的建议
export function runStatus({ cwd, json = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(catalog.skills);
  if (!merged.length) {
    console.log(tr(lang, 'status.empty'));
    return;
  }

  console.error(tr(lang, 'status.loading'));
  const usage = scanUsage({ log: (msg) => console.error(msg), lang });
  const usageOf = buildUsageLookup(merged, usage);

  const zombies = merged.filter((m) => usageOf(m).count === 0);
  const zombieRate = zombies.length / merged.length;
  const dupEntities = merged.filter(isDupEntity);
  const mcpNames = [...new Set(catalog.mcpServers.map((s) => s.name))];
  const { idle: idleMcp, unobservable: codexOnlyMcp } = findIdleMcp(catalog.mcpServers, usage);
  const { tips, primary } = buildCleanupTips({ merged, usageOf, idleMcp });

  const sessions = buildSessionIndex();
  const logBytes = sessions.reduce((s, x) => s + x.size, 0);
  const plan = planClean(sessions, { keep: 3, days: 30 });
  const reclaimBytes = plan.groups.flatMap((g) => g.toDelete).reduce((s, x) => s + x.size, 0);

  const score = computeHealthScore({ zombieRate, dupGroups: dupEntities.length, idleMcp: idleMcp.length, logBytes });

  if (json) {
    console.log(JSON.stringify({
      score,
      skills: merged.length,
      mcpServers: mcpNames.length,
      zombies: zombies.length,
      zombieRate: Number(zombieRate.toFixed(2)),
      dupEntities: dupEntities.length,
      idleMcp,
      unobservableMcp: codexOnlyMcp,
      sessionBytes: logBytes,
      reclaimableBytes: reclaimBytes,
      primaryCleanTargets: primary,
      scannedAt: catalog.scannedAt,
    }, null, 2));
    return;
  }

  // 分值/文案先构造再统一选色，避免同一模板字符串在多个分支重复书写
  const scorePaint = score >= 80 ? paint.green : score >= 60 ? paint.yellow : paint.red;
  const zombieLine = tr(lang, 'status.zombieLine', { count: zombies.length, pct: Math.round(zombieRate * 100) });
  const label = (s) => pad(s, 10);
  const no = tr(lang, 'common.none');
  const joiner = lang === 'en' ? ', ' : '、';

  console.log(paint.bold(tr(lang, 'status.title', { ago: fmtAgoLang(lang, catalog.scannedAt) })));
  console.log(`  ${label(tr(lang, 'status.total'))}  ${paint.bold(tr(lang, 'status.totalLine', { skills: merged.length, mcp: mcpNames.length }))}`);
  console.log(`  ${label(tr(lang, 'status.zombie'))}  ${zombieRate >= 0.4 ? paint.red(zombieLine) : zombieLine}`);
  console.log(`  ${label(tr(lang, 'status.duplicates'))}  ${dupEntities.length ? paint.yellow(tr(lang, 'status.dupLine', { count: dupEntities.length })) : paint.green(no)}`);
  console.log(`  ${label(tr(lang, 'status.idleMcp'))}  ${idleMcp.length ? paint.yellow(idleMcp.join(joiner)) : paint.green(no)}${codexOnlyMcp.length ? paint.gray(tr(lang, 'status.codexOnlyMcp', { count: codexOnlyMcp.length })) : ''}`);
  console.log(`  ${label(tr(lang, 'status.sessions'))}  ${fmtBytes(logBytes)}${reclaimBytes ? paint.gray(tr(lang, 'status.reclaim', { bytes: fmtBytes(reclaimBytes) })) : ''}`);
  console.log(`  ${label(tr(lang, 'status.score'))}  ${scorePaint(`${score} / 100`)}`);

  console.log('\n' + paint.bold(tr(lang, 'status.advice')));
  let n = 0;
  for (const tip of tips) {
    const localized = localizeTip(tip, lang);
    console.log(`  ${++n}. ${localized.text}${tr(lang, 'status.tipSeparator')}${paint.cyan(tip.command)}${localized.note ? paint.gray(localized.note) : ''}`);
  }
  if (reclaimBytes > 50e6) {
    console.log(`  ${++n}. ${tr(lang, 'status.reclaimTip')}${tr(lang, 'status.tipSeparator')}${paint.cyan('skm sessions --clean --days 30 --keep 3 --dry-run')}`);
  }
  console.log(`  ${++n}. ${tr(lang, 'status.fullReport')}${tr(lang, 'status.tipSeparator')}${paint.cyan('skm audit')}${tr(lang, 'status.auditNote')} | ${paint.cyan('skm dupes')}${tr(lang, 'status.dupesNote')}`);
}

// 健康分（0-100，启发式）：僵尸率最高扣 40，实体双份每组扣 1（上限 20），
// 闲置 MCP 每个扣 5（上限 15），会话日志每 GB 扣 10（上限 15）
export function computeHealthScore({ zombieRate, dupGroups, idleMcp, logBytes }) {
  let score = 100;
  score -= Math.round(zombieRate * 40);
  score -= Math.min(20, dupGroups);
  score -= Math.min(15, idleMcp * 5);
  score -= Math.min(15, Math.round((logBytes / 1e9) * 10));
  return Math.max(0, score);
}

function localizeTip(tip, lang) {
  if (lang !== 'en') return tip;
  if (tip.text.startsWith('双份且从未使用')) {
    const n = tip.text.match(/\d+/)?.[0] || '';
    return {
      ...tip,
      text: `${n} duplicate and never-used skill(s); review these first`,
      note: tip.note ? ' (first 5 only; full list: skm audit --json)' : '',
    };
  }
  if (tip.text === '禁用闲置 MCP') return { ...tip, text: 'Disable idle MCP server(s)', note: '' };
  return tip;
}
