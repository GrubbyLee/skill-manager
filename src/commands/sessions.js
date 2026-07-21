import fs from 'node:fs';
import { buildSessionIndex, planClean, SAFE_WINDOW_MS } from '../sessionsIndex.js';
import { scanUsage } from '../usage.js';
import { renderTable, termWidth } from '../table.js';
import { groupBy, confirm, fmtDay, fmtBytes, paint } from '../utils.js';
import { tr } from '../i18n.js';

const SAFE_HOURS = SAFE_WINDOW_MS / 3600e3;

// skm sessions：按工作区展示会话分布；--clean 按保留策略清理（唯一的写操作是删除会话日志文件）
export function runSessions(opts) {
  const lang = opts.lang || 'zh-CN';
  const sessions = buildSessionIndex();
  if (!sessions.length) {
    console.log(tr(lang, 'sessions.empty'));
    return;
  }
  if (!opts.clean && !opts['dry-run']) return report(sessions, opts);
  return clean(sessions, opts);
}

function report(sessions, { json = false, lang = 'zh-CN' }) {
  // 工作区解析失败的会话以 null 分组，展示层统一映射为占位文案，--json 保持 null 供脚本判断
  const byWorkspace = groupBy(sessions, (s) => s.workspace);
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
    [{ title: tr(lang, 'sessions.col.count'), width: 8 }, { title: tr(lang, 'sessions.col.bytes'), width: 8 }, { title: tr(lang, 'sessions.col.oldest'), width: 10 }, { title: tr(lang, 'sessions.col.newest'), width: 10 }, { title: tr(lang, 'sessions.col.workspace'), width: 0 }],
    rows.map((r) => [r.count, fmtBytes(r.bytes), fmtDay(r.oldest), fmtDay(r.newest), r.workspace ?? unknownLabel(lang)]),
    termWidth(),
  ));
  console.log(`\n${tr(lang, 'sessions.summary', {
    count: sessions.length,
    total: fmtBytes(sum(sessions, 'size')),
    claude: fmtBytes(sum(sessions.filter((s) => s.tool === 'claude-code'), 'size')),
    codex: fmtBytes(sum(sessions.filter((s) => s.tool === 'codex'), 'size')),
  })}`);
  console.log(tr(lang, 'sessions.cleanHint', { hours: SAFE_HOURS }));
}

async function clean(sessions, opts) {
  const lang = opts.lang || 'zh-CN';
  const keep = opts.keep != null ? parsePositiveInt(opts.keep, '--keep', lang) : null;
  const days = opts.days != null ? parsePositiveInt(opts.days, '--days', lang) : null;
  if (keep == null && days == null) {
    console.error(tr(lang, 'sessions.policyRequired'));
    process.exitCode = 1;
    return;
  }

  const { groups: plan, skippedUnknown } = planClean(sessions, { keep, days });
  const allFiles = plan.flatMap((p) => p.toDelete);
  const totalBytes = sum(allFiles, 'size');
  const policyDesc = `${[
    keep != null ? tr(lang, 'sessions.policyKeep', { keep }) : '',
    days != null ? tr(lang, 'sessions.policyDays', { days }) : '',
  ].filter(Boolean).join(' ∪ ')} ∪ ${tr(lang, 'sessions.policySafe', { hours: SAFE_HOURS })}`;
  // --json 模式全程只输出一个 JSON 对象（dry-run 为计划；实际删除后附带 result 字段）
  const planData = {
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
  };

  if (!allFiles.length) {
    if (opts.json) {
      console.log(JSON.stringify(planData, null, 2));
    } else {
      console.log(tr(lang, 'sessions.noClean'));
      if (skippedUnknown) console.log(tr(lang, 'sessions.skippedUnknown', { count: skippedUnknown }));
    }
    return;
  }

  if (opts.json) {
    if (opts['dry-run']) {
      console.log(JSON.stringify(planData, null, 2));
      return;
    }
  } else {
    console.log(`${tr(lang, 'sessions.cleanPlan', { policy: policyDesc })}\n`);
    for (const p of plan.sort((a, b) => sum(b.toDelete, 'size') - sum(a.toDelete, 'size'))) {
      console.log(`  ${p.workspace ?? unknownLabel(lang)}`);
      console.log(tr(lang, 'sessions.deleteLine', { count: p.toDelete.length, bytes: fmtBytes(sum(p.toDelete, 'size')), newest: fmtDay(max(p.toDelete, 'mtimeMs')) }));
    }
    if (skippedUnknown) console.log(`\n  ${tr(lang, 'sessions.skippedUnknownPlan', { label: unknownLabel(lang), count: skippedUnknown })}`);
    console.log(`\n${tr(lang, 'sessions.totalDelete', { count: allFiles.length, bytes: fmtBytes(totalBytes) })}`);
    console.log(tr(lang, 'sessions.tombstoneNote'));

    if (opts['dry-run']) {
      console.log(`\n${tr(lang, 'sessions.dryRunDone')}`);
      return;
    }
  }

  if (!(await confirm(`\n${tr(lang, 'sessions.confirmDelete')}`, { yes: opts.yes }))) return;

  // 兑现墓碑承诺：删除前先把全部日志（含待删的）的使用统计聚合进缓存
  console.error(tr(lang, 'sessions.aggregate'));
  try {
    scanUsage({ log: (msg) => console.error(msg), lang });
  } catch (e) {
    console.error(tr(lang, 'sessions.aggregateFailed', { message: e.message }));
    if (!(await confirm(tr(lang, 'sessions.continueConfirm'), { yes: false }))) return;
  }

  let deleted = 0;
  let failed = 0;
  for (const f of allFiles) {
    try {
      fs.rmSync(f.path);
      deleted++;
    } catch (e) {
      failed++;
      console.error(tr(lang, 'sessions.deleteFailed', { path: f.path, message: e.message }));
    }
  }
  const result = tr(lang, 'sessions.result', { deleted, bytes: fmtBytes(totalBytes), failed });
  if (opts.json) console.log(JSON.stringify({ ...planData, result: { deleted, failed } }, null, 2));
  else console.log(`\n${tr(lang, 'sessions.done', { result })}`);
}

// 严格非负整数：拒绝空串、十六进制、科学计数法等 Number() 会静默放行的形态
function parsePositiveInt(v, flag, lang = 'zh-CN') {
  if (!/^\d+$/.test(String(v))) {
    console.error(tr(lang, 'sessions.intInvalid', { flag, value: v }));
    process.exit(1);
  }
  return Number(v);
}

function unknownLabel(lang) {
  return tr(lang, 'sessions.unknownWorkspace');
}

const sum = (list, key) => list.reduce((s, x) => s + x[key], 0);
const min = (list, key) => list.reduce((s, x) => Math.min(s, x[key]), Infinity);
const max = (list, key) => list.reduce((s, x) => Math.max(s, x[key]), -Infinity);
