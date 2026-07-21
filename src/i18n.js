import { DAY_MS, fmtAgo, fmtDay } from './utils.js';

export const DEFAULT_LANG = 'en';
export const ZH = 'zh-CN';
export const EN = 'en';

const MESSAGES = {
  [ZH]: {
    'common.ok': '正常',
    'common.warn': '提醒',
    'common.fail': '失败',
    'common.none': '无',
    'common.today': '今天',
    'common.yesterday': '昨天',
    'common.daysAgo': ({ days }) => `${days} 天前`,
    'common.monthsAgo': ({ months }) => `${months} 个月前`,
    'common.yearsAgo': ({ years }) => `${years} 年前`,
    'cli.argError': ({ message }) => `参数错误：${message}\n运行 skm help 查看用法。`,
    'cli.toolInvalid': ({ value }) => `--tool 取值应为 claude|codex，收到：${value}`,
    'cli.advisorInvalid': ({ value }) => `--advisor 取值应为 codex|claude，收到：${value}`,
    'cli.scopeInvalid': ({ value }) => `--scope 取值应为 user|project|plugin，收到：${value}`,
    'cli.intInvalid': ({ flag, value }) => `--${flag} 需要非负整数，收到：${value}`,
    'cli.topInvalid': ({ value }) => `--top 需要正整数，收到：${value}`,
    'cli.formatInvalid': ({ value }) => `--format 取值应为 json|html|mermaid，收到：${value}`,
    'cli.langInvalid': ({ value }) => `--lang 取值应为 zh-CN|en，收到：${value}`,
    'cli.unknownCommand': ({ cmd }) => `未知命令：${cmd}\n`,
    'cli.runtimeError': ({ message }) => `执行出错：${message}`,
    'scan.done': '扫描完成 ✓',
    'scan.overview': '扫描概览',
    'scan.summary': '汇总',
    'scan.categories': '分类分布',
    'scan.col.tool': '工具',
    'scan.col.user': '用户',
    'scan.col.project': '项目',
    'scan.col.plugin': '插件',
    'scan.col.archived': '已归档',
    'scan.col.context': '上下文估算',
    'scan.col.metric': '指标',
    'scan.col.value': '数值',
    'scan.col.category': '分类',
    'scan.col.count': '数量',
    'scan.metric.uniqueSkills': '去重后 skill',
    'scan.metric.sameNameBoth': '两侧同名安装',
    'scan.metric.warnings': '解析警告',
    'scan.metric.catalogFile': '目录文件',
    'scan.unit.items': ({ n }) => `${n} 个`,
    'scan.unit.warnings': ({ n }) => `${n} 条`,
    'scan.tokens': ({ n }) => `约 ${n} token`,
    'scan.archivedNote': '说明：已归档目录指名称以 _ 或 . 开头、扫描时未计入的目录。',
    'scan.warningSummary': ({ n, verbose }) => `  警告 ${n} 条${verbose ? '：' : '（--verbose 查看）'}`,
    'scan.catalogWritten': ({ file }) => `目录已写入 ${file}`,
    'scan.catalogMissing': '未找到有效目录文件，先执行扫描…',
    'scan.catalogLoadFailed': '无法加载或生成 skill 目录，请检查 ~/.skill-manager 的写权限后重试 skm scan',
    'doctor.title': 'skm 环境诊断',
    'doctor.col.item': '项目',
    'doctor.col.status': '状态',
    'doctor.col.detail': '说明',
    'doctor.conclusion': ({ fail, warn }) => `结论：${fail ? `${fail} 项失败` : '无失败项'}${warn ? `，${warn} 项提醒` : ''}`,
    'doctor.nextSteps': '建议下一步：',
    'status.empty': '两侧都没有扫描到 skill。先安装一些 skill，或检查 ~/.claude/skills 与 ~/.codex/skills。',
    'status.loading': '正在汇总使用统计与会话数据…',
    'status.title': ({ ago }) => `📊 skill 健康体检（目录扫描于${ago}，过期可 skm scan）`,
    'status.total': '能力总量',
    'status.zombie': '僵尸 skill',
    'status.duplicates': '重复安装',
    'status.idleMcp': '闲置 MCP',
    'status.sessions': '会话日志',
    'status.score': '健康分',
    'status.zombieLine': ({ count, pct }) => `${count} 个从未使用（${pct}%）`,
    'status.totalLine': ({ skills, mcp }) => `${skills} 个 skill / ${mcp} 个 MCP`,
    'status.dupLine': ({ count }) => `${count} 组实体双份`,
    'status.codexOnlyMcp': ({ count }) => `（另有 ${count} 个仅 Codex 侧配置，无法观测）`,
    'status.reclaim': ({ bytes }) => `（按 30 天 ∪ 留 3 个策略可释放 ${bytes}）`,
    'status.advice': '建议',
    'status.tipSeparator': '：',
    'status.reclaimTip': '会话瘦身（先看计划）',
    'status.fullReport': '完整报告',
    'status.auditNote': '（使用频率与僵尸清单）',
    'status.dupesNote': '（重复明细）',
    'install.title': 'skm 本地安装脚本',
    'install.usage': '用法：',
    'install.desc': '说明：',
    'install.descText': '该脚本会在当前仓库执行 npm link，让 skm 命令在本机可用。\n  它不会扫描、清理、禁用或修改 Claude/Codex 数据。',
    'install.unknownArg': ({ args }) => `未知参数：${args}。运行 node scripts/install.mjs --help 查看用法。`,
    'install.nodeTooOld': ({ version }) => `Node.js 版本过低：当前 ${version}，要求 >= 18。`,
    'install.missingPackage': ({ file }) => `未找到 package.json：${file}`,
    'install.missingBin': ({ file }) => `未找到 CLI 入口：${file}`,
    'install.badName': ({ name }) => `package.json name 异常：${name}`,
    'install.missingBinConfig': 'package.json 缺少 bin.skm 配置。',
    'install.dependencies': 'package.json 不应包含 dependencies。',
    'install.checkOk': 'skm 本地安装检查通过',
    'install.projectDir': ({ root }) => `项目目录：${root}`,
    'install.willRun': '即将执行：npm link',
    'install.dryRun': '[dry-run] 未执行安装。',
    'install.verifyFailed': 'npm link 已完成，但 skm help 验证未通过。可以尝试重新打开终端后运行 skm help。',
    'install.done': '安装完成。可以运行：',
    'install.fail': ({ message }) => `安装失败：${message}`,
  },
  [EN]: {
    'common.ok': 'OK',
    'common.warn': 'Warn',
    'common.fail': 'Fail',
    'common.none': 'None',
    'common.today': 'today',
    'common.yesterday': 'yesterday',
    'common.daysAgo': ({ days }) => `${days} days ago`,
    'common.monthsAgo': ({ months }) => `${months} months ago`,
    'common.yearsAgo': ({ years }) => `${years} years ago`,
    'cli.argError': ({ message }) => `Argument error: ${message}\nRun skm help for usage.`,
    'cli.toolInvalid': ({ value }) => `--tool must be claude|codex, received: ${value}`,
    'cli.advisorInvalid': ({ value }) => `--advisor must be codex|claude, received: ${value}`,
    'cli.scopeInvalid': ({ value }) => `--scope must be user|project|plugin, received: ${value}`,
    'cli.intInvalid': ({ flag, value }) => `--${flag} requires a non-negative integer, received: ${value}`,
    'cli.topInvalid': ({ value }) => `--top requires a positive integer, received: ${value}`,
    'cli.formatInvalid': ({ value }) => `--format must be json|html|mermaid, received: ${value}`,
    'cli.langInvalid': ({ value }) => `--lang must be zh-CN|en, received: ${value}`,
    'cli.unknownCommand': ({ cmd }) => `Unknown command: ${cmd}\n`,
    'cli.runtimeError': ({ message }) => `Execution failed: ${message}`,
    'scan.done': 'Scan complete ✓',
    'scan.overview': 'Scan Overview',
    'scan.summary': 'Summary',
    'scan.categories': 'Category Distribution',
    'scan.col.tool': 'Tool',
    'scan.col.user': 'User',
    'scan.col.project': 'Project',
    'scan.col.plugin': 'Plugin',
    'scan.col.archived': 'Archived',
    'scan.col.context': 'Context est.',
    'scan.col.metric': 'Metric',
    'scan.col.value': 'Value',
    'scan.col.category': 'Category',
    'scan.col.count': 'Count',
    'scan.metric.uniqueSkills': 'Unique skills',
    'scan.metric.sameNameBoth': 'Installed on both sides',
    'scan.metric.warnings': 'Parse warnings',
    'scan.metric.catalogFile': 'Catalog file',
    'scan.unit.items': ({ n }) => `${n}`,
    'scan.unit.warnings': ({ n }) => `${n}`,
    'scan.tokens': ({ n }) => `about ${n} tokens`,
    'scan.archivedNote': 'Note: archived directories start with _ or . and are not counted.',
    'scan.warningSummary': ({ n, verbose }) => `  ${n} warning(s)${verbose ? ':' : ' (--verbose to view)'}`,
    'scan.catalogWritten': ({ file }) => `Catalog written to ${file}`,
    'scan.catalogMissing': 'No valid catalog found; running scan first…',
    'scan.catalogLoadFailed': 'Unable to load or generate the skill catalog. Check ~/.skill-manager write permissions and retry skm scan.',
    'doctor.title': 'skm Environment Diagnostics',
    'doctor.col.item': 'Item',
    'doctor.col.status': 'Status',
    'doctor.col.detail': 'Detail',
    'doctor.conclusion': ({ fail, warn }) => `Conclusion: ${fail ? `${fail} failed` : 'no failed checks'}${warn ? `, ${warn} warning(s)` : ''}`,
    'doctor.nextSteps': 'Next steps:',
    'status.empty': 'No skills were found on either side. Install some skills or check ~/.claude/skills and ~/.codex/skills.',
    'status.loading': 'Summarizing usage stats and session data…',
    'status.title': ({ ago }) => `📊 Skill Health Check (catalog scanned ${ago}; run skm scan if stale)`,
    'status.total': 'Total',
    'status.zombie': 'Zombie',
    'status.duplicates': 'Duplicates',
    'status.idleMcp': 'Idle MCP',
    'status.sessions': 'Sessions',
    'status.score': 'Score',
    'status.zombieLine': ({ count, pct }) => `${count} never used (${pct}%)`,
    'status.totalLine': ({ skills, mcp }) => `${skills} skills / ${mcp} MCP servers`,
    'status.dupLine': ({ count }) => `${count} duplicate physical install(s)`,
    'status.codexOnlyMcp': ({ count }) => ` (${count} Codex-only MCP server(s) are unobservable)`,
    'status.reclaim': ({ bytes }) => ` (30 days ∪ keep 3 can reclaim ${bytes})`,
    'status.advice': 'Suggestions',
    'status.tipSeparator': ': ',
    'status.reclaimTip': 'Trim session logs (dry-run first)',
    'status.fullReport': 'Full reports',
    'status.auditNote': ' (usage frequency and zombie list)',
    'status.dupesNote': ' (duplicate details)',
    'install.title': 'skm local install script',
    'install.usage': 'Usage:',
    'install.desc': 'Notes:',
    'install.descText': 'This script runs npm link in the current repository so the skm command is available locally.\n  It does not scan, clean, disable, or modify Claude/Codex data.',
    'install.unknownArg': ({ args }) => `Unknown argument(s): ${args}. Run node scripts/install.mjs --help for usage.`,
    'install.nodeTooOld': ({ version }) => `Node.js is too old: current ${version}, required >= 18.`,
    'install.missingPackage': ({ file }) => `package.json not found: ${file}`,
    'install.missingBin': ({ file }) => `CLI entry not found: ${file}`,
    'install.badName': ({ name }) => `Unexpected package.json name: ${name}`,
    'install.missingBinConfig': 'package.json is missing bin.skm.',
    'install.dependencies': 'package.json must not contain dependencies.',
    'install.checkOk': 'skm local install check passed',
    'install.projectDir': ({ root }) => `Project directory: ${root}`,
    'install.willRun': 'About to run: npm link',
    'install.dryRun': '[dry-run] install not executed.',
    'install.verifyFailed': 'npm link completed, but skm help verification failed. Try opening a new terminal and run skm help.',
    'install.done': 'Install complete. Try:',
    'install.fail': ({ message }) => `Install failed: ${message}`,
  },
};

export function normalizeLang(lang) {
  const s = String(lang || '').trim().toLowerCase().replace('_', '-');
  if (!s) return null;
  if (s === 'zh' || s.startsWith('zh-cn') || s.startsWith('zh-hans')) return ZH;
  if (s === 'en' || s.startsWith('en-')) return EN;
  return null;
}

export function detectLang(explicit) {
  if (explicit != null) return normalizeLang(explicit);
  for (const key of ['SKM_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const lang = normalizeLang(process.env[key]);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}

export function langFromArgv(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang') return normalizeLang(argv[i + 1]);
    if (arg.startsWith('--lang=')) return normalizeLang(arg.slice('--lang='.length));
  }
  return detectLang();
}

export function isEnglish(lang) {
  return detectLang(lang) === EN;
}

export function tr(lang, key, params = {}) {
  const table = MESSAGES[detectLang(lang)] || MESSAGES[DEFAULT_LANG];
  const value = table[key] ?? MESSAGES[ZH][key] ?? key;
  return typeof value === 'function' ? value(params) : value;
}

export function fmtAgoLang(lang, t, nowMs = Date.now()) {
  if (!isEnglish(lang)) return fmtAgo(t, nowMs);
  if (t == null) return '—';
  const day = fmtDay(t);
  if (day === '—') return '—';
  const today = fmtDay(nowMs);
  const days = Math.round((Date.parse(today) - Date.parse(day)) / DAY_MS);
  if (days < 0) return day;
  if (days === 0) return tr(EN, 'common.today');
  if (days === 1) return tr(EN, 'common.yesterday');
  if (days < 30) return tr(EN, 'common.daysAgo', { days });
  if (days < 365) return tr(EN, 'common.monthsAgo', { months: Math.min(11, Math.floor(days / 30)) });
  return tr(EN, 'common.yearsAgo', { years: Math.floor(days / 365) });
}
