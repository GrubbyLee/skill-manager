import fs from 'node:fs';
import path from 'node:path';
import { mergeByDirName, toolLabel } from '../catalog.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { buildCleanupTips, findIdleMcp } from '../advice.js';
import { renderTable, termWidth } from '../table.js';
import { ensureCatalog } from './scan.js';
import { DATA_DIR } from '../paths.js';
import { fmtDay, fmtDateTime, fmtAgo, fileStamp, DAY_MS, paint } from '../utils.js';

const ZOMBIE_DAYS = 90;
const HISTORY_DIR = path.join(DATA_DIR, 'audit-history');

// 健康审计：使用频率、僵尸 skill、MCP 使用情况、上下文/磁盘开销
export function runAudit({ cwd, json = false, history = false }) {
  if (history) return showHistory({ json });

  const catalog = ensureCatalog(cwd);
  const merged = mergeByDirName(catalog.skills);
  if (!merged.length) {
    console.log('目录为空：两侧都没有扫描到 skill，无可审计内容。');
    return;
  }

  console.error('正在解析会话日志（首次较慢，之后增量缓存秒级）…');
  const usage = scanUsage({ log: (msg) => console.error(msg) });
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
  });

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

  console.log(`观察窗口：${fmtDay(usage.earliest)} 起（以现存会话日志与已聚合的墓碑统计为准）\n`);

  console.log(paint.bold(`一、使用频率 Top 20`) + `（共 ${used.length} 个 skill 被用过）`);
  console.log(renderTable(
    [{ title: '名称', width: 30 }, { title: '次数', width: 5 }, { title: '最近使用', width: 10 }, { title: '分类', width: 0 }],
    used.slice(0, 20).map((r) => [r.m.dirName, r.u.count, fmtAgo(r.u.lastUsed), r.m.category]),
    width,
  ));

  console.log('\n' + paint.bold('二、僵尸 skill：') + paint.red(`从未使用 ${neverUsed.length} 个（占 ${Math.round((neverUsed.length / merged.length) * 100)}%）`));
  const byCat = new Map();
  for (const r of neverUsed) {
    if (!byCat.has(r.m.category)) byCat.set(r.m.category, []);
    byCat.get(r.m.category).push(r.m.dirName);
  }
  for (const [cat, names] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  【${cat}】${names.length} 个：${names.join('、')}`);
  }
  if (stale.length) {
    console.log(`  另有 ${stale.length} 个超过 ${ZOMBIE_DAYS} 天未用：${stale.map((r) => r.m.dirName).join('、')}`);
  }

  console.log('\n' + paint.bold('三、MCP 使用情况（使用信号来自 Claude 侧调用；仅 Codex 侧配置的无法观测）'));
  const { idle: idleMcp, unobservable: codexOnlyMcp } = findIdleMcp(catalog.mcpServers, usage);
  const codexOnlySet = new Set(codexOnlyMcp);
  const mcpNames = new Set(catalog.mcpServers.map((s) => s.name));
  const mcpRows = [...mcpNames].map((name) => {
    if (codexOnlySet.has(name)) return [name, '不可观测', '—'];
    const u = usage.mcp[name];
    return [name, u?.count || 0, fmtAgo(u?.lastUsed ?? null)];
  }).sort((a, b) => (typeof b[1] === 'number' ? b[1] : -1) - (typeof a[1] === 'number' ? a[1] : -1));
  console.log(renderTable(
    [{ title: '名称', width: 20 }, { title: '次数', width: 8 }, { title: '最近使用', width: 0 }],
    mcpRows,
    Math.min(width, 60),
  ));
  if (idleMcp.length) console.log(paint.yellow(`  ⚠ Claude 侧从未使用的 MCP：${idleMcp.join('、')} —— MCP schema 全量注入上下文，建议优先禁用`));

  console.log('\n' + paint.bold('四、常驻上下文开销 Top 10（name+description 估算）'));
  const costTop = [...merged].sort((a, b) => b.descTokens - a.descTokens).slice(0, 10);
  for (const m of costTop) {
    const u = usageOf(m);
    console.log(`  ${String(m.descTokens).padStart(4)} token  ${m.dirName}（${toolLabel(m.tools)}，用过 ${u.count} 次）`);
  }

  // 建议与 status 仪表盘共用同一生成逻辑，保证命令与口径一致
  const { tips } = buildCleanupTips({ merged, usageOf, idleMcp });
  console.log('\n' + paint.bold('建议'));
  let n = 0;
  for (const tip of tips) {
    console.log(`  ${++n}. ${tip.text}：${paint.cyan(tip.command)}${tip.note ? paint.gray(tip.note) : ''}`);
  }
  console.log(`  ${++n}. 清理前交叉核对重复明细：${paint.cyan('skm dupes')}`);
}

function archiveSnapshot(snapshot) {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    // 文件名用 Asia/Shanghai 本地时间戳；同一秒内重复运行覆盖同名文件，属预期（避免归档爆炸）
    fs.writeFileSync(path.join(HISTORY_DIR, `audit-${fileStamp()}.json`), JSON.stringify(snapshot, null, 2));
  } catch (e) {
    console.error(`归档失败（不影响本次审计）：${e.message}`);
  }
}

function showHistory({ json = false }) {
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
    console.log('还没有审计归档，先运行一次 skm audit。');
    return;
  }
  console.log(renderTable(
    [{ title: '归档时间', width: 17 }, { title: '总数', width: 5 }, { title: '在用', width: 5 }, { title: '僵尸', width: 5 }, { title: '文件', width: 0 }],
    snapshots.map((s) => [fmtDateTime(s.archivedAt), s.totalSkills, s.usedCount, s.neverUsedCount, s.file]),
    termWidth(),
  ));
  console.log(`\n归档目录：${HISTORY_DIR}（详细数据直接查看对应 JSON 文件）`);
}
