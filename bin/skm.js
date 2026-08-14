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
import { runSetup } from '../src/commands/setup.js';
import { runOutdated } from '../src/commands/outdated.js';
import { runSources } from '../src/commands/sources.js';
import { runState } from '../src/commands/state.js';
import { runWeb } from '../src/commands/web.js';
import { runPolicy, runProfile, runSkillEval, runSkillHistory, runSkillInstall, runSkillLock, runSkillRollback, runSkillUpdate } from '../src/commands/lifecycle.js';
import { detectLang, langFromArgv, tr } from '../src/i18n.js';

const HELP_ZH = `skm —— AIDE skill / MCP 清点、梳理与治理工具
（不修改 AIDE 的配置与 skill 文件，仅 setup / install / update / rollback / profile apply / state set / sessions --clean / disable / enable 例外且均有确认或备份；
 工具自身的目录与缓存写在 ~/.skill-manager，首次运行会解析会话日志建立缓存，需数秒到几十秒）

用法：skm <命令> [选项]

命令：
  （无命令）      治理总览：按清单、风险、使用、状态、版本、生命周期、重复、图谱、会话、推荐分域展示摘要与建议
  status          同上（显式写法）
  doctor          只读环境诊断：Node、目录、catalog、advisor CLI、macOS/Windows CI
  risks           不改 AIDE 数据的风险报告：重复、闲置、高上下文开销、MCP schema 估算、日志体积
  report          生成一页式总览报告（summary/json/html），汇总健康、风险、审计、会话与图谱概览
  web             启动本地只读 Web 工作台（127.0.0.1，三主题，含 3D 加载动画）
  scan            扫描 Claude Code、Codex、Cursor、Gemini、WorkBuddy、Kimi，生成 catalog 后展示同一份治理总览
  outdated        检查 skill 上游版本线索；--online 才访问 GitHub/Gitee 或 git remote
  sources         管理本机补充的 skill 上游地址（list/missing/add/remove/check/wizard）
  state           skill 状态治理：plan 生成降载建议；list 查看 Claude 状态；set 写入 Claude 原生状态
  install         安装 skill（本地目录完整复制；远程 SKILL.md/GitHub/Gitee 目录单文件安装，先审计）
  update          事务更新完整 skill 包；支持实例筛选、批量计划、目录 diff、策略门禁与自动备份
  rollback        从 skm 备份回滚 skill
  lock            生成 / 对比 / 校验 skill 锁定文件
  policy          生命周期策略：init/check
  profile         场景 profile：list/create/apply
  eval            skill 质量评测
  history         查看生命周期事件
  setup           显式安装 skill-navigator 桥接 skill（npm 安装后可选）
  list            按分类列出所有 skill（默认合并两侧同名条目）
  search <词>     关键词搜索 skill（名称/分类/描述，按相关度排序）
  recommend <事>  根据自然语言任务描述推荐最合适的 skill（可选调用本机 Codex/Claude 增强判断）
  ask <事>        以问答口吻给出首选 skill、理由和备选
  graph           生成 skill / MCP 知识图谱（summary/json/html/mermaid，HTML 支持搜索聚焦与节点拖动）
  dupes           重复检测：同名安装 / 内容相同 / 同类多实现 / 文本相似
  audit           健康审计：使用频率、僵尸 skill、MCP 使用、上下文开销、静态安全审计（--history 看归档）
  sessions        按工作区展示会话日志分布；--clean 按保留策略清理
  disable <名>    禁用 skill（目录加 _disabled- 前缀，可逆，支持 --dry-run）；--mcp 禁用 MCP（改配置，先备份）
  enable [名]     恢复被禁用的 skill / MCP（支持 --dry-run）；不带参数列出已禁用项
  help            显示本帮助

通用选项：
  --json          以 JSON 输出（供脚本或 AI 消费）
  --lang <zh-CN|en>  指定输出语言；也可用 SKM_LANG=en / SKM_LANG=zh-CN
  --anonymize     导出时脱敏本机路径、工作区和 MCP 启动命令

list 选项：
  --tool <claude|codex|cursor|gemini|workbuddy|kimi>   只看某个工具
  --category <关键字>      按分类过滤（模糊匹配）
  --scope <user|project|plugin>
  --mcp                   列出 MCP server 而非 skill
  --raw                   不合并同名条目，逐条显示安装记录

scan 选项：
  --verbose               显示全部解析警告
  --export <json>         导出扫描结果；可配 --output 写文件

setup 选项：
  --dry-run               只显示将写入的桥接 skill 目录，不实际安装

outdated 选项：
  --online                联网上游检查（只读；结果缓存 24 小时）
  --refresh               忽略更新检查缓存，重新请求上游

sources 选项：
  skm sources missing      列出缺少上游地址、无法判断版本的 skill
  skm sources add <skill> --source <url> [--tool <工具>] [--scope <范围>] [--instance <ID>] [--all]
  skm sources check <skill> [--tool <工具>] [--scope <范围>] [--instance <ID>] [--all]
  skm sources remove <skill> [--instance <ID>]
  skm sources wizard       交互式逐个补充上游地址

state 选项：
  skm state plan            只读生成治理建议，不修改 skill
  skm state list            查看 Claude Code skillOverrides 当前状态
  skm state set <skill> --tool claude --mode <on|name-only|user-invocable-only|off>
                            写入 Claude Code 原生 skill 状态；修改前备份，默认需确认
  --scope <user|project>    指定写入用户级或项目级 Claude 设置
  --dry-run                 只显示将写入的状态
  --yes                     跳过交互确认（脚本模式）

生命周期选项：
  skm install <源> --tool <claude|codex|cursor|gemini|workbuddy|kimi> [--dry-run] [--yes]
  skm update [skill] [--tool <工具>] [--scope <范围>] [--instance <ID>] [--all] [--dry-run] [--yes]
  skm rollback <skill> [--tool <工具>] [--scope <范围>] [--instance <ID>] [--all] [--dry-run] [--yes]
  --allow-risk            人工复核后允许高危安全发现通过策略门禁
  skm lock [--json]
  skm lock diff [锁定文件] [--json]
  skm lock verify [锁定文件] [--json]
  skm policy init|check [--json]
  skm profile list|create <名称>|apply <名称> [--dry-run] [--yes]
  skm eval [skill] [--all] [--json]
  skm history [skill] [--json]

recommend 选项：
  --top <N>               推荐数量（默认 3）
  --tool <claude|codex|cursor|gemini|workbuddy|kimi>   只推荐某个工具可用的 skill
  --category <关键字>      限制推荐分类
  --why                   显示更详细的命中词与分数
  --advisor <codex|claude> 显式调用本机 AIDE CLI 做增强推荐；失败时回退本地推荐

report 选项：
  --format <summary|html|json>  导出格式；不指定时显示摘要
  --output <文件>          写入文件；可按扩展名自动推断格式
  --anonymize              脱敏报告中的本机路径、工作区和 MCP 启动命令

web 选项：
  --port <端口>            本地监听端口（默认 17361；仅监听 127.0.0.1）

graph 选项：
  --format <summary|json|html|mermaid>  导出格式；不指定时显示图谱摘要
  --output <文件>               写入文件；可按扩展名自动推断格式

sessions 选项：
  --clean                 进入清理模式（需配 --keep 和/或 --days）
  --keep <N>              每工作区保留最近 N 个会话
  --days <N>              保留 N 天以内的会话（与 --keep 取并集）
  --dry-run               只显示清理计划，不删除
  --yes                   跳过交互确认（脚本模式）

disable / enable 选项：
  --mcp                   处理 MCP server 而非 skill 目录
  --dry-run               只显示将执行的禁用/恢复计划，不改目录、不写配置
  --yes                   跳过 MCP 交互确认（脚本模式；skill 目录禁用不需要确认）

示例：
  skm scan
  skm
  skm outdated --online
  skm sources missing
  skm sources add baoyu-image-gen --source https://github.com/org/repo/tree/main/baoyu-image-gen
  skm state plan
  skm state set gsap-plugins --tool claude --mode user-invocable-only
  skm install ./my-skill --tool claude --dry-run
  skm update baoyu-image-gen --dry-run
  skm lock
  skm lock diff
  skm lock verify
  skm policy check
  skm eval --all
  skm doctor
  skm risks
  skm report --format html --output skm-report.html
  skm web
  skm web --port 17362
  skm list --category ppt
  skm search 转 markdown
  skm recommend "把网页转成 markdown"
  skm recommend "生成知识图谱" --advisor codex
  skm ask "做小红书图片卡片"
  skm graph --format html --output skill-graph.html
  skm audit
  skm sessions --clean --days 30 --keep 3 --dry-run
  skm disable gsap-plugins --dry-run
  skm disable --mcp drawio --dry-run
  skm dupes --json`;

const HELP_EN = `skm — AIDE skill / MCP inventory and governance CLI
(Most commands do not modify AIDE configs or skill files. Only setup / install / update / rollback / profile apply / state set / sessions --clean / disable / enable can write files,
 and those actions have explicit command, confirmation, or backup safeguards. skm's own cache lives under ~/.skill-manager.)

Usage: skm <command> [options]

Commands:
  (no command)      Governance overview grouped by inventory, risks, usage, state, versions, lifecycle, duplicates, graph, sessions, and recommendations
  status            Same as above
  doctor            Read-only diagnostics: Node, directories, catalog, advisor CLI, macOS/Windows CI
  risks             Risk report: duplicates, idle MCP, context cost, MCP schema estimate, log size
  report            One-page overview report (summary/json/html): health, risks, usage, sessions, graph summary
  web               Start the local read-only Web dashboard (127.0.0.1, three themes, 3D loading animation)
  scan              Scan Claude Code, Codex, Cursor, Gemini, WorkBuddy, and Kimi, write the catalog, then show the same governance overview
  outdated          Check skill upstream freshness; --online accesses GitHub/Gitee or git remotes
  sources           Manage local skill upstream sources (list/missing/add/remove/check/wizard)
  state             Skill state governance: plan recommendations, list Claude states, set Claude native state
  install           Install a skill after local static audit
  update            Transactionally update complete skill packages with instance selection, diff, policy gates, and backups
  rollback          Roll back a skill from skm backups
  lock              Generate, diff, or verify the skill lock file
  policy            Lifecycle policy: init/check
  profile           Scenario profiles: list/create/apply
  eval              Evaluate skill quality
  history           Show lifecycle events
  setup             Explicitly install the skill-navigator bridge skill after npm install
  list              List all skills by category
  search <text>     Search skills by name, category, and description
  recommend <task>  Recommend the best skills for a natural-language task
  ask <task>        Q&A-style recommendation with best match, reasons, and alternatives
  graph             Generate a skill / MCP knowledge graph (summary/json/html/mermaid)
  dupes             Duplicate detection: same name / same content / same category / text similarity
  audit             Usage audit: skill/MCP frequency, zombie skills, context cost, static security audit (--history for snapshots)
  sessions          Show session logs by workspace; --clean applies a retention policy
  disable <name>    Disable skills by renaming directories (supports --dry-run); --mcp disables MCP servers with backups
  enable [name]     Restore disabled skills / MCP servers (supports --dry-run); without names, list disabled items
  help              Show this help

Global options:
  --json            Output JSON for scripts or other tools
  --lang <zh-CN|en> Select output language; SKM_LANG=en / SKM_LANG=zh-CN also works
  --anonymize       Redact local paths, workspaces, and MCP launch commands in exports

list options:
  --tool <claude|codex|cursor|gemini|workbuddy|kimi>   Show only one tool
  --category <keyword>    Filter by category
  --scope <user|project|plugin>
  --mcp                   List MCP servers instead of skills
  --raw                   Do not merge same-name installs

scan options:
  --verbose               Show all parse warnings
  --export <json>         Export scan result; combine with --output to write a file

setup options:
  --dry-run               Show bridge skill targets without installing

outdated options:
  --online                Check upstream online (read-only; cached for 24 hours)
  --refresh               Ignore update-check cache and request upstream again

sources options:
  skm sources missing      List skills whose freshness cannot be checked
  skm sources add <skill> --source <url> [--tool <tool>] [--scope <scope>] [--instance <ID>] [--all]
  skm sources check <skill> [--tool <tool>] [--scope <scope>] [--instance <ID>] [--all]
  skm sources remove <skill> [--instance <ID>]
  skm sources wizard       Fill missing upstream URLs interactively

state options:
  skm state plan            Generate a read-only state governance plan
  skm state list            List current Claude Code skillOverrides states
  skm state set <skill> --tool claude --mode <on|name-only|user-invocable-only|off>
                            Write Claude Code native skill state with backup and confirmation
  --scope <user|project>    Write user-level or project-level Claude settings
  --dry-run                 Show the intended state write without changing files
  --yes                     Skip interactive confirmation for scripts

lifecycle options:
  skm install <source> --tool <claude|codex|cursor|gemini|workbuddy|kimi> [--dry-run] [--yes]
  skm update [skill] [--tool <tool>] [--scope <scope>] [--instance <ID>] [--all] [--dry-run] [--yes]
  skm rollback <skill> [--tool <tool>] [--scope <scope>] [--instance <ID>] [--all] [--dry-run] [--yes]
  --allow-risk            Allow high-severity findings after explicit manual review
  skm lock [--json]
  skm lock diff [lock-file] [--json]
  skm lock verify [lock-file] [--json]
  skm policy init|check [--json]
  skm profile list|create <name>|apply <name> [--dry-run] [--yes]
  skm eval [skill] [--all] [--json]
  skm history [skill] [--json]

recommend options:
  --top <N>               Number of recommendations (default 3)
  --tool <claude|codex|cursor|gemini|workbuddy|kimi>   Recommend skills available to one tool
  --category <keyword>    Restrict recommendation category
  --why                   Show matched terms and score details
  --advisor <codex|claude> Explicitly call local AIDE CLI for enhanced recommendation; falls back locally on failure

report options:
  --format <summary|html|json>  Export format; omitted means summary
  --output <file>         Write to file; format can be inferred from extension
  --anonymize             Redact local paths, workspaces, and MCP launch commands

web options:
  --port <port>           Local port (default 17361; listens on 127.0.0.1 only)

graph options:
  --format <summary|json|html|mermaid>  Export format; omitted means summary
  --output <file>               Write to file; format can be inferred from extension

sessions options:
  --clean                 Cleanup mode (requires --keep and/or --days)
  --keep <N>              Keep latest N sessions per workspace
  --days <N>              Keep sessions newer than N days
  --dry-run               Print cleanup plan without deleting
  --yes                   Skip interactive confirmation

disable / enable options:
  --mcp                   Target MCP servers instead of skill directories
  --dry-run               Preview disable/restore actions without renaming directories or writing configs
  --yes                   Skip MCP confirmation for scripts; skill directory toggles do not ask for confirmation

Examples:
  skm scan
  skm
  skm outdated --online
  skm sources missing
  skm sources add baoyu-image-gen --source https://github.com/org/repo/tree/main/baoyu-image-gen
  skm state plan
  skm state set gsap-plugins --tool claude --mode user-invocable-only
  skm install ./my-skill --tool claude --dry-run
  skm update baoyu-image-gen --dry-run
  skm lock
  skm lock diff
  skm lock verify
  skm policy check
  skm eval --all
  skm setup
  skm doctor
  skm risks
  skm report --format html --output skm-report.html
  skm web
  skm web --port 17362
  skm list --category ppt
  skm search markdown
  skm recommend "convert a web page to markdown"
  skm recommend "create a knowledge graph" --advisor codex
  skm ask "create image cards"
  skm graph --format html --output skill-graph.html
  skm audit
  skm sessions --clean --days 30 --keep 3 --dry-run
  skm disable gsap-plugins --dry-run
  skm disable --mcp drawio --dry-run
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
      all: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      history: { type: 'boolean', default: false },
      why: { type: 'boolean', default: false },
      anonymize: { type: 'boolean', default: false },
      'allow-risk': { type: 'boolean', default: false },
      online: { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
      keep: { type: 'string' },
      days: { type: 'string' },
      top: { type: 'string' },
      format: { type: 'string' },
      output: { type: 'string' },
      export: { type: 'string' },
      port: { type: 'string' },
      source: { type: 'string' },
      repository: { type: 'string' },
      homepage: { type: 'string' },
      version: { type: 'string' },
      mode: { type: 'string' },
      tool: { type: 'string' },
      advisor: { type: 'string' },
      lang: { type: 'string' },
      category: { type: 'string' },
      scope: { type: 'string' },
      instance: { type: 'string' },
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

if (values.tool && !['claude', 'claude-code', 'codex', 'cursor', 'gemini', 'workbuddy', 'kimi'].includes(values.tool)) {
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
if (values.port != null && (!/^\d+$/.test(values.port) || Number(values.port) < 1 || Number(values.port) > 65535)) {
  console.error(lang === 'en' ? `--port must be an integer from 1 to 65535, received: ${values.port}` : `--port 必须是 1-65535 的整数，收到：${values.port}`);
  process.exit(1);
}
if (values.format && !['summary', 'json', 'html', 'mermaid'].includes(values.format)) {
  console.error(tr(lang, 'cli.formatInvalid', { value: values.format }));
  process.exit(1);
}
if (values.mode && !['on', 'name-only', 'user-only', 'user-invocable-only', 'off'].includes(values.mode)) {
  console.error(tr(lang, 'cli.modeInvalid', { value: values.mode }));
  process.exit(1);
}
if (values.export && values.export !== 'json') {
  console.error(tr(lang, 'cli.exportInvalid', { value: values.export }));
  process.exit(1);
}

const cmd = positionals[0] || 'status';
const ctx = { cwd: process.cwd(), ...values, dryRun: values['dry-run'], allowRisk: values['allow-risk'], lang };

async function main() {
  if (values.help || cmd === 'help') console.log(lang === 'en' ? HELP_EN : HELP_ZH);
  else if (cmd === 'status') runStatus(ctx);
  else if (cmd === 'doctor') runDoctor(ctx);
  else if (cmd === 'risks') runRisks(ctx);
  else if (cmd === 'report') runReport(ctx);
  else if (cmd === 'web') runWeb(ctx);
  else if (cmd === 'scan') runScan(ctx);
  else if (cmd === 'outdated') await runOutdated(ctx);
  else if (cmd === 'sources') await runSources(ctx, positionals.slice(1));
  else if (cmd === 'state') await runState(ctx, positionals.slice(1));
  else if (cmd === 'install') await runSkillInstall(ctx, positionals.slice(1));
  else if (cmd === 'update') await runSkillUpdate(ctx, positionals.slice(1));
  else if (cmd === 'rollback') await runSkillRollback(ctx, positionals.slice(1));
  else if (cmd === 'lock') runSkillLock(ctx, positionals.slice(1));
  else if (cmd === 'policy') runPolicy(ctx, positionals.slice(1));
  else if (cmd === 'profile') await runProfile(ctx, positionals.slice(1));
  else if (cmd === 'eval') runSkillEval(ctx, positionals.slice(1));
  else if (cmd === 'history') runSkillHistory(ctx, positionals.slice(1));
  else if (cmd === 'setup') runSetup(ctx);
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
