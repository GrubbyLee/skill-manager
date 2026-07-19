import { mergeByDirName } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { buildSessionIndex, planClean } from '../sessionsIndex.js';
import { ensureCatalog } from './scan.js';
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
  // 实体双份：同名多处安装且并非软链共享同一实体
  const dupEntities = merged.filter((m) => m.entries.length > 1 && new Set(m.entries.map((e) => e.realPath)).size > 1);
  const mcpNames = [...new Set(catalog.mcpServers.map((s) => s.name))];
  const idleMcp = mcpNames.filter((name) => !(usage.mcp[name]?.count > 0));

  const sessions = buildSessionIndex();
  const logBytes = sessions.reduce((s, x) => s + x.size, 0);
  const plan = planClean(sessions, { keep: 3, days: 30 });
  const reclaimBytes = plan.groups.flatMap((g) => g.toDelete).reduce((s, x) => s + x.size, 0);

  const score = computeHealthScore({ zombieRate, dupGroups: dupEntities.length, idleMcp: idleMcp.length, logBytes });
  // 最优先清理对象：从未使用 且 实体双份 的交集
  const dupSet = new Set(dupEntities.map((m) => m.dirName));
  const primaryTargets = zombies.map((m) => m.dirName).filter((n) => dupSet.has(n));

  if (json) {
    console.log(JSON.stringify({
      score,
      skills: merged.length,
      mcpServers: mcpNames.length,
      zombies: zombies.length,
      zombieRate: Number(zombieRate.toFixed(2)),
      dupEntities: dupEntities.length,
      idleMcp,
      sessionBytes: logBytes,
      reclaimableBytes: reclaimBytes,
      primaryCleanTargets: primaryTargets,
      scannedAt: catalog.scannedAt,
    }, null, 2));
    return;
  }

  const scoreText = score >= 80 ? paint.green(`${score} / 100`) : score >= 60 ? paint.yellow(`${score} / 100`) : paint.red(`${score} / 100`);
  const zombieText = zombieRate >= 0.4
    ? paint.red(`${zombies.length} 个从未使用（${Math.round(zombieRate * 100)}%）`)
    : `${zombies.length} 个从未使用（${Math.round(zombieRate * 100)}%）`;

  console.log(paint.bold('📊 skill 健康体检') + paint.gray(`（目录扫描于${fmtAgo(catalog.scannedAt)}，过期可 skm scan）`));
  console.log(`  能力总量   ${paint.bold(String(merged.length))} 个 skill / ${mcpNames.length} 个 MCP`);
  console.log(`  僵尸 skill  ${zombieText}`);
  console.log(`  重复安装   ${dupEntities.length ? paint.yellow(`${dupEntities.length} 组实体双份`) : paint.green('无')}`);
  console.log(`  闲置 MCP   ${idleMcp.length ? paint.yellow(idleMcp.join('、')) : paint.green('无')}`);
  console.log(`  会话日志   ${fmtBytes(logBytes)}${reclaimBytes ? paint.gray(`（按 30 天 ∪ 留 3 个策略可释放 ${fmtBytes(reclaimBytes)}）`) : ''}`);
  console.log(`  健康分     ${scoreText}`);

  const tips = [];
  if (primaryTargets.length) {
    const show = primaryTargets.slice(0, 5).join(' ');
    tips.push(`双份且从未使用 ${primaryTargets.length} 个，最优先清理：${paint.cyan(`skm disable ${show}${primaryTargets.length > 5 ? ' …' : ''}`)}`);
  }
  if (idleMcp.length) tips.push(`禁用闲置 MCP：${paint.cyan(`skm disable --mcp ${idleMcp.join(' ')}`)}`);
  if (reclaimBytes > 50e6) tips.push(`会话瘦身（先看计划）：${paint.cyan('skm sessions --clean --days 30 --keep 3 --dry-run')}`);
  tips.push(`完整报告：${paint.cyan('skm audit')}（使用频率与僵尸清单） | ${paint.cyan('skm dupes')}（重复明细）`);

  console.log('\n' + paint.bold('建议'));
  tips.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
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
