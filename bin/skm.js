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

const HELP = `skm —— AIDE skill / MCP 清点、梳理与治理工具
（不修改 AIDE 的配置与 skill 文件，仅 sessions --clean / disable / enable 例外且均有确认与备份；
 工具自身的目录与缓存写在 ~/.skill-manager，首次运行会解析会话日志建立缓存，需数秒到几十秒）

用法：skm <命令> [选项]

命令：
  （无命令）      健康体检概览：总量 / 僵尸率 / 重复 / 会话体积 / 健康分 + 建议
  status          同上（显式写法）
  scan            扫描 Claude Code 与 Codex，生成 ~/.skill-manager/catalog.json
  list            按分类列出所有 skill（默认合并两侧同名条目）
  search <词>     关键词搜索 skill（名称/分类/描述，按相关度排序）
  recommend <事>  根据自然语言任务描述推荐最合适的 skill（结合使用频率与两侧可用性）
  ask <事>        以问答口吻给出首选 skill、理由和备选
  graph           生成 skill / MCP 知识图谱（summary/json/html/mermaid）
  dupes           重复检测：同名安装 / 内容相同 / 同类多实现 / 文本相似
  audit           健康审计：使用频率、僵尸 skill、MCP 使用、上下文开销（--history 看归档）
  sessions        按工作区展示会话日志分布；--clean 按保留策略清理
  disable <名>    禁用 skill（目录加 _disabled- 前缀，可逆）；--mcp 禁用 MCP（改配置，先备份）
  enable [名]     恢复被禁用的 skill / MCP；不带参数列出已禁用项
  help            显示本帮助

通用选项：
  --json          以 JSON 输出（供脚本或 AI 消费）

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

graph 选项：
  --format <json|html|mermaid>  导出格式；不指定时显示图谱摘要
  --output <文件>               写入文件；可按扩展名自动推断格式

sessions 选项：
  --clean                 进入清理模式（需配 --keep 和/或 --days）
  --keep <N>              每工作区保留最近 N 个会话
  --days <N>              保留 N 天以内的会话（与 --keep 取并集）
  --dry-run               只显示清理计划，不删除
  --yes                   跳过交互确认（脚本模式）

示例：
  skm scan
  skm list --category ppt
  skm search 转 markdown
  skm recommend "把网页转成 markdown"
  skm ask "做小红书图片卡片"
  skm graph --format html --output skill-graph.html
  skm audit
  skm sessions --clean --days 30 --keep 3 --dry-run
  skm disable gsap-plugins
  skm disable --mcp drawio
  skm dupes --json`;

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
      category: { type: 'string' },
      scope: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
} catch (e) {
  console.error(`参数错误：${e.message}\n运行 skm help 查看用法。`);
  process.exit(1);
}
const { values, positionals } = parsed;

if (values.tool && !['claude', 'claude-code', 'codex'].includes(values.tool)) {
  console.error(`--tool 取值应为 claude|codex，收到：${values.tool}`);
  process.exit(1);
}
if (values.scope && !['user', 'project', 'plugin'].includes(values.scope)) {
  console.error(`--scope 取值应为 user|project|plugin，收到：${values.scope}`);
  process.exit(1);
}
for (const flag of ['keep', 'days']) {
  if (values[flag] != null && !/^\d+$/.test(values[flag])) {
    console.error(`--${flag} 需要非负整数，收到：${values[flag]}`);
    process.exit(1);
  }
}
if (values.top != null && !/^\d+$/.test(values.top)) {
  console.error(`--top 需要正整数，收到：${values.top}`);
  process.exit(1);
}
if (values.format && !['json', 'html', 'mermaid'].includes(values.format)) {
  console.error(`--format 取值应为 json|html|mermaid，收到：${values.format}`);
  process.exit(1);
}

const cmd = positionals[0] || 'status';
const ctx = { cwd: process.cwd(), ...values };

async function main() {
  if (values.help || cmd === 'help') console.log(HELP);
  else if (cmd === 'status') runStatus(ctx);
  else if (cmd === 'scan') runScan(ctx);
  else if (cmd === 'list') runList(ctx);
  else if (cmd === 'search') runSearch({ ...ctx, keywords: positionals.slice(1) });
  else if (cmd === 'recommend') runRecommend({ ...ctx, keywords: positionals.slice(1) });
  else if (cmd === 'ask') runAsk({ ...ctx, keywords: positionals.slice(1) });
  else if (cmd === 'graph') runGraph(ctx);
  else if (cmd === 'dupes') runDupes(ctx);
  else if (cmd === 'audit') runAudit(ctx);
  else if (cmd === 'sessions') await runSessions(ctx);
  else if (cmd === 'disable') await runDisable({ ...ctx, names: positionals.slice(1) });
  else if (cmd === 'enable') await runEnable({ ...ctx, names: positionals.slice(1) });
  else {
    console.error(`未知命令：${cmd}\n`);
    console.log(HELP);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`执行出错：${e.message}`);
  process.exitCode = 1;
});
