#!/usr/bin/env node
// skm —— skill-manager CLI：扫描、梳理并治理 Claude Code / Codex 的 skill 与 MCP
import { parseArgs } from 'node:util';
import { runScan } from '../src/commands/scan.js';
import { runList } from '../src/commands/list.js';
import { runDupes } from '../src/commands/dupes.js';
import { runAudit } from '../src/commands/audit.js';
import { runSearch } from '../src/commands/search.js';
import { runAsk, runRecommend } from '../src/commands/recommend.js';
import { runGraph } from '../src/commands/graph.js';
import { runSessions } from '../src/commands/sessions.js';
import { runDisable, runEnable } from '../src/commands/toggle.js';
import { runStatus } from '../src/commands/status.js';
import { runDoctor } from '../src/commands/doctor.js';
import { runRisks } from '../src/commands/risks.js';
import { runReport } from '../src/commands/report.js';
import { detectLang, langFromArgv, tr } from '../src/i18n.js';

const HELP_ZH = `skm —— AIDE skill / MCP 清点、梳理与治理工具
（不修改 AIDE 的配置与 skill 文件，仅 sessions --clean / disable / enable 例外且均有确认与备份；
 工具自身的目录与缓存写在 ~/.skill-manager，首次运行会解析会话日志建立缓存，需数秒到几十秒）

用法：skm <命令> [选项]

命令：
  （无命令）      健康体检概览：总量 / 僵尸率 / 重复 / 会话体积 / 健康分 + 建议
  status          同上（显式写法）
  doctor          只读环境诊断：Node、目录、catalog、advisor CLI、macOS/Windows CI
  risks           不改 AIDE 数据的风险报告：重复、闲置、高上下文开销、日志体积、MCP 可观测性
  report          生成一页式总览报告（summary/json/html），汇总健康、风险、审计、会话与图谱概览
  scan            扫描 Claude Code 与 Codex，生成 ~/.skill-manager/catalog.json
  list            按分类列出所有 skill（默认合并两侧同名条目）
  search <词>     关键词搜索 skill（名称/分类/描述，按相关度排序）
  recommend <事>  根据自然语言任务描述推荐最合适的 skill（可选调用本机 Codex/Claude 增强判断）
  ask <事>        以问答口吻给出首选 skill、理由和备选
  graph           生成 skill / MCP 知识图谱（summary/json/html/mermaid，HTML 支持搜索聚焦与节点拖动）
  dupes           重复检测：同名安装 / 内容相同 / 同类多实现 / 文本相似
  audit           健康审计：使用频率、僵尸 skill、MCP 使用、上下文开销（--history 看归档）
  sessions        按工作区展示会话日志分布；--clean 按保留策略清理
  disable <名>    禁用 skill（目录加 _disabled- 前缀，可逆）；--mcp 禁用 MCP（改配置，先备份）
  enable [名]     恢复被禁用的 skill / MCP；不带参数列出已禁用项
  help            显示本帮助

通用选项：
  --json          以 JSON 输出（供脚本或 AI 消费）
  --lang <zh-CN|en>  指定输出语言；也可用 SKM_LANG=en / SKM_LANG=zh-CN

list 选项：
  --tool <claude|codex>   只看某个工具
  --category <关键字>      按分类过滤（模糊匹配）
  --scope <user|project|plugin>
  --mcp                   列出 MCP server 而非 skill
  --raw                   不合并同名条目，逐条显示安装记录

scan 选项：
  --verbose               显示全部解析警告

recommend 选项：
  --top <N>               推荐数量（默认 3）
  --tool <claude|codex>   只推荐某个工具可用的 skill
  --category <关键字>      限制推荐分类
  --why                   显示更详细的命中词与分数
  --advisor <codex|claude> 显式调用本机 AIDE CLI 做增强推荐；失败时回退本地推荐

report 选项：
  --format <summary|html|json>  导出格式；不指定时显示摘要
  --output <文件>          写入文件；可按扩展名自动推断格式

graph 选项：
  --format <summary|json|html|mermaid>  导出格式；不指定时显示图谱摘要
  --output <文件>               写入文件；可按扩展名自动推断格式

sessions 选项：
  --clean                 进入清理模式（需配 --keep 和/或 --days）
  --keep <N>              每工作区保留最近 N 个会话
  --days <N>              保留 N 天以内的会话（与 --keep 取并集）
  --dry-run               只显示清理计划，不删除
  --yes                   跳过交互确认（脚本模式）

示例：
  skm scan
  skm doctor
  skm risks
  skm report --format html --output skm-report.html
  skm list --category ppt
  skm search 转 markdown
  skm recommend "把网页转成 markdown"
  skm recommend "生成知识图谱" --advisor codex
  skm ask "做小红书图片卡片"
  skm graph --format html --output skill-graph.html
  skm audit
  skm sessions --clean --days 30 --keep 3 --dry-run
  skm disable gsap-plugins
  skm disable --mcp drawio
  skm dupes --json`;

const HELP_EN = `skm — AIDE skill / MCP inventory and governance CLI
(Most commands do not modify AIDE configs or skill files. Only sessions --clean / disable / enable can write files,
 and those actions have confirmation and backup safeguards. skm's own cache lives under ~/.skill-manager.)

Usage: skm <command> [options]

Commands:
  (no command)      Health overview: totals / zombie rate / duplicates / session size / score + suggestions
  status            Same as above
  doctor            Read-only diagnostics: Node, directories, catalog, advisor CLI, macOS/Windows CI
  risks             Risk report: duplicates, idle MCP, context cost, log size, MCP observability
  report            One-page overview report (summary/json/html): health, risks, usage, sessions, graph summary
  scan              Scan Claude Code and Codex, write ~/.skill-manager/catalog.json
  list              List all skills by category
  search <text>     Search skills by name, category, and description
  recommend <task>  Recommend the best skills for a natural-language task
  ask <task>        Q&A-style recommendation with best match, reasons, and alternatives
  graph             Generate a skill / MCP knowledge graph (summary/json/html/mermaid)
  dupes             Duplicate detection: same name / same content / same category / text similarity
  audit             Usage audit: skill/MCP frequency, zombie skills, context cost (--history for snapshots)
  sessions          Show session logs by workspace; --clean applies a retention policy
  disable <name>    Disable skills by renaming directories; --mcp disables MCP servers with backups
  enable [name]     Restore disabled skills / MCP servers; without names, list disabled items
  help              Show this help

Global options:
  --json            Output JSON for scripts or other tools
  --lang <zh-CN|en> Select output language; SKM_LANG=en / SKM_LANG=zh-CN also works

list options:
  --tool <claude|codex>   Show only one tool
  --category <keyword>    Filter by category
  --scope <user|project|plugin>
  --mcp                   List MCP servers instead of skills
  --raw                   Do not merge same-name installs

scan options:
  --verbose               Show all parse warnings

recommend options:
  --top <N>               Number of recommendations (default 3)
  --tool <claude|codex>   Recommend skills available to one tool
  --category <keyword>    Restrict recommendation category
  --why                   Show matched terms and score details
  --advisor <codex|claude> Explicitly call local AIDE CLI for enhanced recommendation; falls back locally on failure

report options:
  --format <summary|html|json>  Export format; omitted means summary
  --output <file>         Write to file; format can be inferred from extension

graph options:
  --format <summary|json|html|mermaid>  Export format; omitted means summary
  --output <file>               Write to file; format can be inferred from extension

sessions options:
  --clean                 Cleanup mode (requires --keep and/or --days)
  --keep <N>              Keep latest N sessions per workspace
  --days <N>              Keep sessions newer than N days
  --dry-run               Print cleanup plan without deleting
  --yes                   Skip interactive confirmation

Examples:
  skm scan
  skm doctor
  skm risks
  skm report --format html --output skm-report.html
  skm list --category ppt
  skm search markdown
  skm recommend "convert a web page to markdown"
  skm recommend "create a knowledge graph" --advisor codex
  skm ask "create image cards"
  skm graph --format html --output skill-graph.html
  skm audit
  skm sessions --clean --days 30 --keep 3 --dry-run
  skm disable gsap-plugins
  skm disable --mcp drawio
  skm dupes --json`;

const initialLang = langFromArgv(process.argv.slice(2));

// 入口即校验（Fail Fast）：未知选项给中文提示而非裸堆栈；枚举参数拼错立即报错而非静默空结果
let parsed;
try {
  parsed = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      mcp: { type: 'boolean', default: false },
      raw: { type: 'boolean', default: false },
      clean: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      history: { type: 'boolean', default: false },
      why: { type: 'boolean', default: false },
      keep: { type: 'string' },
      days: { type: 'string' },
      top: { type: 'string' },
      format: { type: 'string' },
      output: { type: 'string' },
      tool: { type: 'string' },
      advisor: { type: 'string' },
      lang: { type: 'string' },
      category: { type: 'string' },
      scope: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
} catch (e) {
  console.error(tr(initialLang, 'cli.argError', { message: e.message }));
  process.exit(1);
}
const { values, positionals } = parsed;
const lang = detectLang(values.lang);

if (!lang) {
  console.error(tr('en', 'cli.langInvalid', { value: values.lang }));
  process.exit(1);
}

if (values.tool && !['claude', 'claude-code', 'codex'].includes(values.tool)) {
  console.error(tr(lang, 'cli.toolInvalid', { value: values.tool }));
  process.exit(1);
}
if (values.advisor && !['codex', 'claude'].includes(values.advisor)) {
  console.error(tr(lang, 'cli.advisorInvalid', { value: values.advisor }));
  process.exit(1);
}
if (values.scope && !['user', 'project', 'plugin'].includes(values.scope)) {
  console.error(tr(lang, 'cli.scopeInvalid', { value: values.scope }));
  process.exit(1);
}
for (const flag of ['keep', 'days']) {
  if (values[flag] != null && !/^\d+$/.test(values[flag])) {
    console.error(tr(lang, 'cli.intInvalid', { flag, value: values[flag] }));
    process.exit(1);
  }
}
if (values.top != null && !/^\d+$/.test(values.top)) {
  console.error(tr(lang, 'cli.topInvalid', { value: values.top }));
  process.exit(1);
}
if (values.format && !['summary', 'json', 'html', 'mermaid'].includes(values.format)) {
  console.error(tr(lang, 'cli.formatInvalid', { value: values.format }));
  process.exit(1);
}

const cmd = positionals[0] || 'status';
const ctx = { cwd: process.cwd(), ...values, lang };

async function main() {
  if (values.help || cmd === 'help') console.log(lang === 'en' ? HELP_EN : HELP_ZH);
  else if (cmd === 'status') runStatus(ctx);
  else if (cmd === 'doctor') runDoctor(ctx);
  else if (cmd === 'risks') runRisks(ctx);
  else if (cmd === 'report') runReport(ctx);
  else if (cmd === 'scan') runScan(ctx);
  else if (cmd === 'list') runList(ctx);
  else if (cmd === 'search') runSearch({ ...ctx, keywords: positionals.slice(1) });
  else if (cmd === 'recommend') await runRecommend({ ...ctx, keywords: positionals.slice(1) });
  else if (cmd === 'ask') runAsk({ ...ctx, keywords: positionals.slice(1) });
  else if (cmd === 'graph') runGraph(ctx);
  else if (cmd === 'dupes') runDupes(ctx);
  else if (cmd === 'audit') runAudit(ctx);
  else if (cmd === 'sessions') await runSessions(ctx);
  else if (cmd === 'disable') await runDisable({ ...ctx, names: positionals.slice(1) });
  else if (cmd === 'enable') await runEnable({ ...ctx, names: positionals.slice(1) });
  else {
    console.error(tr(lang, 'cli.unknownCommand', { cmd }));
    console.log(lang === 'en' ? HELP_EN : HELP_ZH);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(tr(lang, 'cli.runtimeError', { message: e.message }));
  process.exitCode = 1;
});
