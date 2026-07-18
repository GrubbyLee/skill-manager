import fs from 'node:fs';
import { buildSessionIndex, selectDeletions, SAFE_WINDOW_MS } from '../sessionsIndex.js';
import { scanUsage } from '../usage.js';
import { renderTable, termWidth } from '../table.js';
import { groupBy, confirm, fmtDay } from '../utils.js';

const UNKNOWN_LABEL = '（未知工作区）';
const SAFE_HOURS = SAFE_WINDOW_MS / 3600e3;

// skm sessions：按工作区展示会话分布；--clean 按保留策略清理（唯一的写操作是删除会话日志文件）
export function runSessions(opts) {
  const sessions = buildSessionIndex();
  if (!sessions.length) {
    console.log('未发现任何会话日志。');
    return;
  }
  // 工作区解析失败的会话以 null 分组，展示层统一映射为占位文案，--json 保持 null 供脚本判断
  const byWorkspace = groupBy(sessions, (s) => s.workspace);

  if (!opts.clean && !opts['dry-run']) return report(byWorkspace, sessions, opts);
  return clean(byWorkspace, opts);
}

function report(byWorkspace, sessions, { json = false }) {
  const rows = [...byWorkspace.entries()]
    .map(([ws, list]) => ({
      workspace: ws,
      count: list.length,
      bytes: sum(list, 'size'),
      oldest: min(list, 'mtimeMs'),
      newest: max(list, 'mtimeMs'),
      tools: [...new Set(list.map((s) => s.tool))],
    }))
    .sort((a, b) => b.bytes - a.bytes);

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(renderTable(
    [{ title: '会话数', width: 6 }, { title: '体积', width: 8 }, { title: '最老', width: 10 }, { title: '最新', width: 10 }, { title: '工作区', width: 0 }],
    rows.map((r) => [r.count, fmtBytes(r.bytes), fmtDay(r.oldest), fmtDay(r.newest), r.workspace ?? UNKNOWN_LABEL]),
    termWidth(),
  ));
  console.log(`\n合计 ${sessions.length} 个会话，${fmtBytes(sum(sessions, 'size'))}（Claude ${fmtBytes(sum(sessions.filter((s) => s.tool === 'claude-code'), 'size'))} + Codex ${fmtBytes(sum(sessions.filter((s) => s.tool === 'codex'), 'size'))}）`);
  console.log(`清理：skm sessions --clean --days 30 [--keep 3] [--dry-run]（每工作区保留 最近N个 ∪ N天内 ∪ ${SAFE_HOURS}小时内活跃；未知工作区只按天数清理）`);
}

async function clean(byWorkspace, opts) {
  const keep = opts.keep != null ? parsePositiveInt(opts.keep, '--keep') : null;
  const days = opts.days != null ? parsePositiveInt(opts.days, '--days') : null;
  if (keep == null && days == null) {
    console.error('清理必须指定保留策略：--keep <个数> 和/或 --days <天数>，例如 skm sessions --clean --days 30 --keep 3');
    process.exitCode = 1;
    return;
  }

  const plan = [];
  let skippedUnknown = 0;
  for (const [ws, list] of byWorkspace) {
    // 未知工作区可能混着多个真实项目的会话，不参与"每工作区保留 N 个"的配额：
    // 有 --days 时只按天数清理，只有 --keep 时整组跳过（宁多留不少留）
    let toDelete;
    if (ws === null) {
      if (days == null) {
        skippedUnknown = list.length;
        continue;
      }
      ({ toDelete } = selectDeletions(list, { keep: null, days }));
    } else {
      ({ toDelete } = selectDeletions(list, { keep, days }));
    }
    if (toDelete.length) plan.push({ workspace: ws, toDelete });
  }
  const allFiles = plan.flatMap((p) => p.toDelete);
  const totalBytes = sum(allFiles, 'size');
  const policyDesc = `${[keep != null ? `每工作区最近 ${keep} 个` : '', days != null ? `${days} 天以内` : ''].filter(Boolean).join(' ∪ ')} ∪ ${SAFE_HOURS}小时内活跃`;

  if (opts.json) {
    console.log(JSON.stringify({
      keep,
      days,
      dryRun: !!opts['dry-run'],
      skippedUnknown,
      groups: plan.map((p) => ({
        workspace: p.workspace,
        deleteCount: p.toDelete.length,
        bytes: sum(p.toDelete, 'size'),
        files: p.toDelete.map((f) => f.path),
      })),
      totalFiles: allFiles.length,
      totalBytes,
    }, null, 2));
    if (opts['dry-run'] || !allFiles.length) return;
  } else {
    if (!allFiles.length) {
      console.log('按该策略没有可清理的会话。');
      if (skippedUnknown) console.log(`（另有 ${skippedUnknown} 个未知工作区会话仅接受 --days 策略，已整组跳过）`);
      return;
    }
    console.log(`清理计划（保留策略：${policyDesc}）：\n`);
    for (const p of plan.sort((a, b) => sum(b.toDelete, 'size') - sum(a.toDelete, 'size'))) {
      console.log(`  ${p.workspace ?? UNKNOWN_LABEL}`);
      console.log(`    删除 ${p.toDelete.length} 个会话，释放 ${fmtBytes(sum(p.toDelete, 'size'))}（最新的一个止于 ${fmtDay(max(p.toDelete, 'mtimeMs'))}）`);
    }
    if (skippedUnknown) console.log(`\n  ${UNKNOWN_LABEL}的 ${skippedUnknown} 个会话仅接受 --days 策略，本次整组跳过`);
    console.log(`\n共删除 ${allFiles.length} 个会话文件，释放 ${fmtBytes(totalBytes)}。`);
    console.log('删除前会先把这些日志的使用统计聚合进缓存（墓碑机制），因此不影响 skm audit 的累计数字。');

    if (opts['dry-run']) {
      console.log('\n[dry-run] 未执行删除。确认无误后去掉 --dry-run 重新运行。');
      return;
    }
  }

  if (!(await confirm('\n确认删除以上会话？输入 yes 执行，其他任意键取消：', { yes: opts.yes }))) return;

  // 兑现墓碑承诺：删除前先把全部日志（含待删的）的使用统计聚合进缓存
  console.error('正在聚合使用统计（墓碑预写入）…');
  try {
    scanUsage({ log: (msg) => console.error(msg) });
  } catch (e) {
    console.error(`使用统计聚合失败：${e.message}`);
    if (!(await confirm('继续删除将丢失这些日志尚未聚合的统计，仍要继续？输入 yes 继续：', { yes: false }))) return;
  }

  let deleted = 0;
  let failed = 0;
  for (const f of allFiles) {
    try {
      fs.rmSync(f.path);
      deleted++;
    } catch (e) {
      failed++;
      console.error(`  删除失败：${f.path}（${e.message}）`);
    }
  }
  const result = `已删除 ${deleted} 个会话文件，释放约 ${fmtBytes(totalBytes)}${failed ? `；失败 ${failed} 个` : ''}`;
  if (opts.json) console.log(JSON.stringify({ deleted, failed, totalBytes }, null, 2));
  else console.log(`\n完成：${result}。`);
}

function parsePositiveInt(v, flag) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`${flag} 需要非负整数，收到：${v}`);
    process.exit(1);
  }
  return n;
}

const sum = (list, key) => list.reduce((s, x) => s + x[key], 0);
const min = (list, key) => list.reduce((s, x) => Math.min(s, x[key]), Infinity);
const max = (list, key) => list.reduce((s, x) => Math.max(s, x[key]), -Infinity);
const fmtBytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'MB' : Math.round(n / 1e3) + 'KB');
