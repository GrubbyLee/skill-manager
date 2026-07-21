# skm 完整命令手册

本文是 README 的详细版，适合在安装后查命令、看参数、做排查。

## 安装

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
```

不想全局 link 时，可以直接运行：

```bash
node bin/skm.js scan
node bin/skm.js ask "把网页转成 markdown"
```

安装脚本支持 dry-run：

```bash
node scripts/install.mjs --dry-run
```

## 语言

CLI 支持显式指定输出语言：

```bash
skm help --lang en
skm scan --lang zh-CN
SKM_LANG=en skm doctor
skm recommend "convert a web page to markdown" --lang en
skm graph --format html --output skill-graph.html --lang en
```

当前已覆盖 `help`、参数错误、`doctor`、`scan`、`status`、`risks`、`report`、`list`、`search`、`recommend`、`ask`、`graph`、`dupes`、`audit`、`sessions`、`disable`、`enable` 与安装脚本；`--json` 的字段名保持稳定。

## 推荐排查流程

```bash
skm doctor
skm scan
skm
skm risks
skm report --format html --output skm-report.html
skm dupes
skm audit
skm list --mcp
skm sessions
skm sessions --clean --days 30 --keep 3 --dry-run
```

建议先只读排查，确认报告无误后再考虑 `disable`、`enable` 或 `sessions --clean`。

## 命令一览

| 命令 | 用途 | 常用选项 |
|---|---|---|
| `skm` / `skm status` | 一屏健康体检 | `--json` |
| `skm doctor` | 环境诊断 | `--json` |
| `skm risks` | 风险报告 | `--json` |
| `skm report` | 一页式总览报告 | `--format html`、`--output`、`--json` |
| `skm scan` | 扫描 skill / MCP | `--verbose`、`--json` |
| `skm list` | 列出 skill | `--category`、`--tool`、`--scope`、`--raw`、`--json` |
| `skm list --mcp` | 列出 MCP | `--tool`、`--json` |
| `skm search <词>` | 搜索 skill | `--json` |
| `skm recommend <任务>` | 推荐 skill | `--top`、`--tool`、`--category`、`--why`、`--advisor`、`--json` |
| `skm ask <任务>` | 问答式推荐 | `--tool`、`--category`、`--json` |
| `skm graph` | 知识图谱 | `--format json\|html\|mermaid`、`--output` |
| `skm dupes` | 重复检测 | `--json` |
| `skm audit` | 使用审计 | `--history`、`--json` |
| `skm sessions` | 会话日志分布 | `--json` |
| `skm sessions --clean` | 清理会话日志 | `--days`、`--keep`、`--dry-run`、`--yes` |
| `skm disable <名>` | 软禁用 skill | 可一次传多个名称 |
| `skm enable [名]` | 恢复 skill | 不带名称时列出已禁用项 |
| `skm disable --mcp <名>` | 禁用 MCP | 自动备份，需确认 |
| `skm enable --mcp <名>` | 恢复 MCP | 自动备份，需确认 |
| `skm help` | 查看帮助 | 同 `skm -h` |

## scan

扫描 Claude Code / Codex 的 skill 与 MCP，生成 `~/.skill-manager/catalog.json`。

```bash
skm scan
skm scan --verbose
skm scan --json
```

输出会包含：

- Claude Code 与 Codex 两侧 skill 数量
- 用户、项目、插件来源分布
- MCP 数量
- 已归档目录数量
- 去重后 skill 总数
- 两侧同名安装数量
- 常驻上下文开销估算
- 分类分布

已归档目录指名称以 `_` 或 `.` 开头、扫描时未计入的目录。

## status

裸命令 `skm` 等价于 `skm status`，用于查看健康体检。

```bash
skm
skm status --json
```

健康分为 0-100 的启发式评分，会综合僵尸率、实体双份、闲置 MCP、会话日志体积。它用于清理前后自我对比，不代表绝对质量。

## doctor 与 risks

```bash
skm doctor
skm risks
skm doctor --json
skm risks --json
```

`doctor` 检查运行环境，例如 Node.js 版本、目录、catalog、advisor CLI、CI 配置。

`risks` 汇总分级风险，例如实体双份、双份且从未使用、闲置 MCP、高上下文开销、会话日志体积、不可观测项。它不直接禁用或删除任何 AIDE 数据。

## report

```bash
skm report
skm report --format html --output skm-report.html
skm report --json
```

`report` 会生成一页式总览，包含健康分、风险、使用频率、上下文开销、会话日志、知识图谱摘要和下一步命令。HTML 报告是零依赖单文件，可直接用浏览器打开。详细说明见 [report.md](report.md)。

## list 与 search

```bash
skm list
skm list --category 图像
skm list --tool codex
skm list --scope user
skm list --raw
skm list --mcp
skm search markdown
```

`list` 默认合并两侧同名 skill；`--raw` 会显示每条安装记录。`search` 会在名称、分类、description 中匹配。

## recommend 与 ask

```bash
skm recommend "把网页转成 markdown"
skm recommend "做小红书图片卡片" --tool codex --category 图像 --top 3
skm recommend "markdown to html" --why
skm ask "生成漂亮的知识图谱"
```

`recommend` 适合比较多个候选；`ask` 适合直接得到首选和备选。详细说明见 [recommend.md](recommend.md)。

## graph

```bash
skm graph
skm graph --format html --output skill-graph.html
skm graph --format json --output skill-graph.json
skm graph --format mermaid --output skill-graph.md
```

HTML 图谱是单文件，无需联网或额外依赖。详细说明见 [graph.md](graph.md)。

## dupes

```bash
skm dupes
skm dupes --json
```

重复检测分四层：

- 同名多处安装
- 名字不同但内容完全相同
- 同类多实现
- 名称与描述文本高度相似

同名检测会区分软链共享同一实体、实体内容完全相同、实体内容不同。

## audit

```bash
skm audit
skm audit --history
skm audit --json
```

`audit` 解析会话日志，还原真实使用情况：

- Claude Code：Skill 工具调用、斜杠命令、MCP 工具调用
- Codex：只统计 `function_call` 中实际读取 `SKILL.md` 的行为

解析结果会写入 `~/.skill-manager/usage-cache.json` 做增量缓存；每次审计还会归档快照到 `~/.skill-manager/audit-history/`。

## sessions

```bash
skm sessions
skm sessions --json
skm sessions --clean --days 30 --keep 3 --dry-run
skm sessions --clean --days 30 --keep 3
```

`sessions` 按工作区统计 Claude / Codex 会话日志数量、体积、最早和最新时间。

清理策略：

- `--days <N>`：保留 N 天内的会话
- `--keep <N>`：每个工作区保留最近 N 个会话
- 同时给出时取并集，宁多留不少留
- 24 小时内活跃的会话永不删除
- 未知工作区只接受 `--days` 策略
- 删除前会先把统计聚合进缓存

## disable 与 enable

```bash
skm disable gsap-plugins
skm enable gsap-plugins
skm enable
skm disable --mcp drawio
skm enable --mcp drawio
```

skill 禁用只是目录重命名加 `_disabled-` 前缀，可逆且不删除文件。MCP 禁用会修改配置文件，修改前会自动备份并要求确认。

## 自定义分类规则

创建 `~/.skill-manager/rules.json`：

```json
{
  "rules": [
    { "category": "我的分类", "prefixes": ["my-"], "keywords": ["某关键词"] }
  ],
  "overrides": {
    "some-skill": "研发辅助"
  }
}
```

用户规则优先于内置规则，`overrides` 可以直接指定单个 skill 的分类。
