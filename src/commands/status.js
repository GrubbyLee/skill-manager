import { mergeByDirName, isDupEntity } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { buildSessionIndex, planClean } from '../sessionsIndex.js';
import { buildCleanupTips, findIdleMcp } from '../advice.js';
import { ensureCatalog } from './scan.js';
import { pad } from '../table.js';
import { paint, fmtAgo, fmtBytes } from '../utils.js';

// skm 裸命令 = 一屏健康体检：总量 / 僵尸率 / 重复 / 会话体积 / 健康分 + 可直接执行的建议
export function runStatus({ cwd, json = false }) {
  const catalog = ensureCatalog(cwd);
  const merged = mergeByDirName(catalog.skills);
  if (!merged.length) {
    console.log('两侧都没有扫描到 skill。先安装一些 skill，或检查 ~/.claude/skills 与 ~/.codex/skills。');
    return;
  }

  console.error('正在汇总使用统计与会话数据…');
  const usage = scanUsage({ log: (msg) => console.error(msg) });
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
  const zombieLine = `${zombies.length} 个从未使用（${Math.round(zombieRate * 100)}%）`;
  const label = (s) => pad(s, 10);

  console.log(paint.bold('📊 skill 健康体检') + paint.gray(`（目录扫描于${fmtAgo(catalog.scannedAt)}，过期可 skm scan）`));
  console.log(`  ${label('能力总量')}  ${paint.bold(String(merged.length))} 个 skill / ${mcpNames.length} 个 MCP`);
  console.log(`  ${label('僵尸 skill')}  ${zombieRate >= 0.4 ? paint.red(zombieLine) : zombieLine}`);
  console.log(`  ${label('重复安装')}  ${dupEntities.length ? paint.yellow(`${dupEntities.length} 组实体双份`) : paint.green('无')}`);
  console.log(`  ${label('闲置 MCP')}  ${idleMcp.length ? paint.yellow(idleMcp.join('、')) : paint.green('无')}${codexOnlyMcp.length ? paint.gray(`（另有 ${codexOnlyMcp.length} 个仅 Codex 侧配置，无法观测）`) : ''}`);
  console.log(`  ${label('会话日志')}  ${fmtBytes(logBytes)}${reclaimBytes ? paint.gray(`（按 30 天 ∪ 留 3 个策略可释放 ${fmtBytes(reclaimBytes)}）`) : ''}`);
  console.log(`  ${label('健康分')}  ${scorePaint(`${score} / 100`)}`);

  console.log('\n' + paint.bold('建议'));
  let n = 0;
  for (const tip of tips) {
    console.log(`  ${++n}. ${tip.text}：${paint.cyan(tip.command)}${tip.note ? paint.gray(tip.note) : ''}`);
  }
  if (reclaimBytes > 50e6) {
    console.log(`  ${++n}. 会话瘦身（先看计划）：${paint.cyan('skm sessions --clean --days 30 --keep 3 --dry-run')}`);
  }
  console.log(`  ${++n}. 完整报告：${paint.cyan('skm audit')}（使用频率与僵尸清单） | ${paint.cyan('skm dupes')}（重复明细）`);
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
