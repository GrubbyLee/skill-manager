<p align="center">
  <img src="docs/logo.svg" alt="skill-manager" width="720">
</p>

# skill-manager（skm）

[English](README.md) | 简体中文

[![macOS / Windows 按需验证](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml)
[![Linux 本机验证](https://img.shields.io/badge/Linux-locally_validated-FCC624?logo=linux&logoColor=black)](#跨端验证)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-3c873a)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-2f6f4e)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/GrubbyLee/skill-manager?style=social)](https://github.com/GrubbyLee/skill-manager/stargazers)

> Claude Code / Codex / Cursor / Gemini / WorkBuddy / Kimi skill 与 MCP 的扫描、推荐、去重、审计和全生命周期治理工具。

一台机器装久了，skill 会越来越像一间堆满工具的工作室：有的重复，有的很久没用，有的藏在软链后面，有的 MCP 每次启动都占上下文。`skm` 做的事很简单：清点它们、解释它们、帮你决定下一步。

[![skm 中文介绍视频动态预览](docs/demo.zh-CN.gif)](https://grubbylee.github.io/skill-manager/?lang=zh-CN)

*动态预览 · 点击播放带配音和控制条的完整中文介绍。*

## 30 秒体验

```bash
npm i -g aide-skill-manager

skm scan
skm
skm ask "我要把网页转成 Markdown"
skm outdated
skm lock
skm lock verify
skm policy check
skm web
skm report --format html --output skm-report.html
skm graph --format html --output skill-graph.html
```

可选：安装桥接 skill，让 Claude Code / Codex 在对话里直接调用本机 `skm`：

```bash
skm setup
```

`npm i -g` 负责安装 `skm` 命令。`skm setup` 是显式写操作，会把附属 `skill-navigator` 桥接 skill 安装到 `~/.claude/skills/` 和 `~/.codex/skills/`。这样你在 AIDE 内询问“该用哪个 skill”时，它可以默认访问本机 `skm`。

如果 npm 官方源较慢，国内可临时使用镜像安装：

```bash
npm i -g aide-skill-manager --registry=https://registry.npmmirror.com
```

源码安装仍然保留，适合本地开发或从 Gitee 镜像体验：

```bash
git clone https://gitee.com/synovation/skill-manager.git
cd skill-manager
node scripts/install.mjs
```

源码安装脚本会在克隆后的仓库内执行 `npm link`，并安装桥接 skill。

CLI 输出支持语言切换：

```bash
skm scan --lang en
SKM_LANG=zh-CN skm doctor
```

## 它解决什么

| 你遇到的问题 | 运行 | skm 给你的答案 |
|---|---|---|
| 我到底装了多少 skill / MCP？ | `skm scan` | 刷新目录，并在扫描事实后展示治理总览 |
| 这台机器状态健康吗？ | `skm` | 按清单、风险、使用、状态、版本、重复、图谱、会话、推荐分域展示问题与下一步 |
| 做某件事该用哪个 skill？ | `skm ask "任务"` | 首选 skill、理由、备选 |
| 哪些 skill 重复了？ | `skm dupes` | 同名、同内容、同类多实现、文本相似 |
| 哪些从未真正用过？ | `skm audit` | 使用频率、僵尸 skill、MCP 调用记录、静态安全发现 |
| skill 太多但不想删除？ | `skm state plan` | 给出 `on` / `name-only` / `user-invocable-only` / `off` 降载建议 |
| 来自 GitHub/Gitee 的 skill 是否最新？ | `skm outdated --online` | 版本 / commit 新旧检查；只读并缓存 |
| 太多 skill 显示无法判断版本？ | `skm sources wizard` | 把缺失的上游地址补到 skm 本地来源表 |
| 能否形成安装、更新、回滚闭环？ | `skm lock` / `skm lock verify` / `skm policy check` | 生成本机 skill 锁定文件，对比当前环境是否漂移，并按策略检查治理基线 |
| 某个 skill 质量如何？ | `skm eval <skill>` | 从描述、来源、重复、使用、安全信号给出评分 |
| 命令太多，想直接可视化查看？ | `skm web` | 本地只读 Web 工作台，集中查看总览、清单、图谱、推荐和命令中心 |
| skill 之间有什么关系？ | `skm graph --format html` | 可筛选、可拖动、单文件知识图谱 |
| 当前有没有用户风险？ | `skm risks` | 分级风险清单和保守处理建议 |
| 能否导出一页总览？ | `skm report --format html` | 健康、风险、使用、会话、图谱摘要汇总 |
| 能否安全分享扫描/报告结果？ | `skm scan --export json --output scan.json --anonymize` | 脱敏路径、配置位置、工作区、MCP 命令和上游 URL |
| 会话日志太大怎么办？ | `skm sessions` | 按工作区统计日志体积，支持 dry-run 清理计划 |
| 能让编程助手直接调用 skm 吗？ | `skm setup` 后在 AIDE 内提问 | `skill-navigator` 桥接 skill 会代你调用本机 `skm` |

## 命令速查

| 命令 | 用途 |
|---|---|
| `skm` / `skm status` | 一屏治理总览，按基础子命令分域给出摘要和建议 |
| `skm doctor` | 只读环境诊断 |
| `skm risks` | 风险报告，不修改 AIDE 数据 |
| `skm report` | 一页式总览报告 |
| `skm web` | 启动本地只读 Web 工作台，支持赛博朋克 / 宇宙星系 / 蓝天白云三主题 |
| `skm scan` | 扫描 skill / MCP，重建目录，然后展示同一份治理总览 |
| `skm outdated` | 检查上游版本线索；`--online` 比对 GitHub/Gitee 或 git remote |
| `skm sources` | 管理缺少来源 metadata 的 skill 上游地址 |
| `skm install` | 静态审计后安装本地/仓库完整 skill 包或直链 `SKILL.md` |
| `skm update` | 按实例展示整包差异、通过策略门禁后事务式更新 |
| `skm rollback` | 从实例隔离的整包备份恢复 skill |
| `skm lock` | 生成 `~/.skill-manager/skill-lock.json` 生命周期锁定文件，按安装实例记录 |
| `skm lock diff` | 对比当前 skill 与锁定文件的新增、删除和变更 |
| `skm lock verify` | 校验当前 skill 是否匹配锁定文件；发现漂移时返回非 0，适合 CI |
| `skm policy` | 初始化 / 检查 skill 生命周期策略 |
| `skm profile` | 创建或应用 Claude Code 场景状态 profile |
| `skm eval` | 评测 skill 质量和治理缺口 |
| `skm history` | 查看安装、更新、回滚、profile 等生命周期事件 |
| `skm setup` | 安装可选的 `skill-navigator` 桥接 skill |
| `skm list` / `skm list --mcp` | 列出 skill 或 MCP |
| `skm search <关键词>` | 按名称、分类、描述搜索 |
| `skm recommend <任务>` | 表格形式推荐 skill |
| `skm ask <任务>` | 问答形式推荐 skill |
| `skm graph` | 导出知识图谱 |
| `skm dupes` | 检测重复与相似 skill |
| `skm audit` | 审计真实使用频率和静态安全信号 |
| `skm state` | 生成 skill 状态治理计划；查看/写入 Claude Code 原生状态 |
| `skm sessions` | 查看会话日志分布 |
| `skm sessions --clean` | 按策略清理会话日志，需确认 |
| `skm disable` / `skm enable` | 软禁用或恢复 skill / MCP |

完整命令说明见 [docs/usage.md](docs/usage.md)。

附属桥接 skill：运行 `skm setup` 会安装 `skill-navigator`，供 Claude Code / Codex 调用本机 `skm`；它不是 CLI 命令。

面向 skill hub 的独立桥接 skill 说明：[integrations/skill-navigator/README.zh-CN.md](integrations/skill-navigator/README.zh-CN.md)。平台发布流程：[docs/skill-publishing.md](docs/skill-publishing.md)。

## 项目特性

- 多工具覆盖：统一扫描 Claude Code、Codex CLI、Cursor、Gemini 的 skill，并尽量读取常见 MCP 配置
- 软链感知：区分共享实体、实体双份和内容不同
- 四级重复检测：同名、同内容、同类多实现、文本高度相似
- 真实使用审计：解析可观测会话日志，只统计真正读取或调用过的 skill / MCP；Claude Code / Codex 信号更完整，Cursor / Gemini 暂以扫描和静态安全审计为主
- 状态治理：对过多、重复、长期未用或高上下文开销的 skill 给出降载建议；Claude Code 支持写入原生 `skillOverrides`
- 生命周期治理：支持安装、来源登记、更新、回滚、锁定、策略检查、profile 和质量评测
- 静态安全审计：识别疑似外发密钥、破坏性命令、提示词注入、MCP 命令携带密钥等信号
- 上游版本检查：识别来自 GitHub/Gitee 或 git remote 的 skill 是否可能落后，但不自动更新
- 推荐增强：自然语言推荐会在相关候选内学习你的常用分类和套件偏好
- MCP 开销估算：标记高 schema 上下文开销的 MCP server
- 知识图谱：导出 JSON、Mermaid 或单文件 HTML，包含更丰富的关系和摘要
- 总览报告：导出单文件 HTML，汇总健康、风险、使用、会话、MCP schema 估算与图谱摘要
- 匿名导出：扫描与报告支持脱敏，便于开源社区反馈
- 零第三方依赖：全部功能基于 Node.js 内置模块实现
- 双语入口：README 默认英文，中文文档保留；核心 CLI 输出支持中英文切换
- 开源友好：macOS / Windows 通过 GitHub Actions 按需验证，Linux 由维护者本机验证

## 推荐 skill

当你只知道“我要做什么”，但不确定该用哪个 skill：

```bash
skm ask "把网页转成 markdown"
skm recommend "生成小红书图片卡片" --top 5
skm recommend "markdown to html" --why
```

推荐逻辑默认完全本地运行，不调用外部模型，不上传目录信息。它会综合名称、分类、description、中文任务意图、转换方向、历史使用、最近使用和各扫描工具侧的可用性。

本地排序还会从真实使用记录里学习轻量个人偏好：只有候选已经和任务相关时，常用分类或常用套件才会获得小幅加权，不会让高频但无关的 skill 混入推荐结果。

推荐规则改动会经过 40 条中英文公开回归样本检验。可运行 `npm run benchmark:recommend` 查看结果；指标定义和适用边界见 [推荐功能文档](docs/recommend.md#可度量的回归基准)。

如果你明确希望借助本机已有的 Codex / Claude Code 做增强判断，可以手动开启：

```bash
skm recommend "生成知识图谱" --advisor codex --why
skm recommend "整理会议纪要" --advisor claude
```

增强模式只会发送按相关性压缩后的精简候选清单，不发送 skill 路径、真实配置路径、MCP `env` 值、API Key、密码或密钥文件。详细说明见 [docs/recommend.md](docs/recommend.md)。

## 知识图谱

```bash
skm graph --format html --output skill-graph.html
```

生成结果是零依赖单 HTML 文件，可直接用浏览器打开。左侧可以筛选关系、限制节点上限、隐藏闲置节点或只看重点节点；右侧只显示当前筛选结果涉及的节点和连线。节点可拖动，搜索会临时放开节点上限，适合 skill 很多时先收敛再定位。

![skm skill 知识图谱示意图](docs/graphic.png)

支持的关系包括套件归属、分类归属、重复、强/弱替代、流程、上下游、共享输入输出格式、反向转换、平台归属、平台内分工、使用 MCP。关系含义和交互说明见 [docs/graph.md](docs/graph.md)。

## 总览报告

```bash
skm report --format html --output skm-report.html
skm report --format html --output skm-report.html --anonymize
```

报告会把健康分、风险项、使用频率、上下文开销、MCP schema 估算、会话日志、图谱摘要和下一步命令放到一页本地 HTML。对外分享前建议加 `--anonymize`。详细说明见 [docs/report.md](docs/report.md)。

## Web 工作台

```bash
skm web
skm web --port 17362
```

`skm web` 会在 `127.0.0.1` 启动本地只读工作台，把总览、skill 清单、知识图谱、推荐入口和命令中心放到一个现代科技感页面里。页面右上角支持中英文切换，默认跟随 CLI 启动语言，并把用户选择保存在浏览器本地；同时保留赛博朋克、宇宙星系、蓝天白云三种主题切换。Skill 清单默认按使用次数降序，支持按使用次数或上下文开销切换排序、上下双端分页，并可在悬浮时查看已记录的上游地址；技能名称悬浮还会显示描述。3D 图谱不再只做展示：它会汇总前缀套件、功能重叠、可串联流程和 MCP 依赖，可按具体套件、平台或分类聚焦，并支持一跳关系、置信度证据、建议命令及清单定位。只读命令可在网页内运行并在卡片终端返回结果；安装、更新、回滚、禁用、恢复等写操作仍只提供可复制的 dry-run 建议。页面内置真实 3D 立体加载动画。工作台在缺少事实或手动刷新时，可能读取 AIDE 的 skill/MCP 元数据，并刷新 skm 自身的 `~/.skill-manager/catalog.json` 或缓存文件；但不会修改 AIDE 数据，不会执行 skill/MCP，也不会读取 MCP `env` 值。

![skm Web 工作台真机截图](docs/web-dashboard.zh-CN.png)

## 四格小漫画

| 工具间太满了 | 扫描贴标签 |
|---|---|
| ![工具间太满了](docs/comic-01-tool-chaos.jpg) | ![扫描贴标签](docs/comic-02-scan-labels.jpg) |

| 知识图谱亮起来 | 安全收纳 |
|---|---|
| ![知识图谱亮起来](docs/comic-03-knowledge-map.jpg) | ![安全收纳](docs/comic-04-safe-cleanup.jpg) |

## 一般排查流程

```bash
skm doctor
skm scan
skm
skm scan --export json --output skm-scan.json --anonymize
skm risks
skm outdated
skm outdated --online
skm sources missing
skm sources wizard
skm lock
skm lock verify
skm policy check
skm eval --all
skm state plan
skm report --format html --output skm-report.html
skm report --format html --output skm-report.html --anonymize
skm dupes
skm audit
skm list --mcp
skm sessions
skm sessions --clean --days 30 --keep 3 --dry-run
```

排查时先用 `skm scan` 刷新事实；扫描结束后会直接显示治理总览。之后单独运行 `skm` 不会强制重扫，而是基于已有 catalog、使用统计和会话索引，按基础子命令分域提示问题在哪里、下一步该运行什么。`skm state plan` 适合在发现 skill 太多时先做降载方案，而不是直接删除。`skm outdated` 默认离线，只看本地 metadata；`skm outdated --online` 才访问上游且不会自动更新 skill。如果大量 skill 因缺少 source/repository 而无法判断，可用 `skm sources missing` 或 `skm sources wizard` 把上游地址补到 `~/.skill-manager/sources.json`。需要建立生命周期基线时，用 `skm lock` 固化当前清单，用 `skm lock diff` 查看后续漂移，用 `skm lock verify` 在脚本或 CI 中校验是否偏离基线，用 `skm policy check` 检查是否超过治理阈值，用 `skm eval --all` 找出最需要整理的 skill。需要发到社区或 Issue 时用匿名导出；运行写操作前先 dry-run；只想浏览事实时停在 `skm sessions` 即可。

### skill 全生命周期治理

`skm` 不只回答“装了什么”，也开始覆盖 skill 从引入到复盘的完整链路：

```bash
skm install ./my-skill --tool claude --dry-run
skm install https://github.com/org/repo/tree/main/skills/my-skill --tool codex --dry-run
skm update baoyu-image-gen --dry-run
skm rollback baoyu-image-gen --dry-run
skm lock
skm lock diff
skm lock verify
skm policy init
skm policy check
skm profile create writing
skm profile apply writing --dry-run
skm eval --all
skm history baoyu-image-gen
```

| 阶段 | 命令 | 说明 |
|---|---|---|
| 引入 | `skm install <源>` | 本地目录和 GitHub/Gitee/git 目录来源安装完整包；直链 `SKILL.md` 安装单文件；所有目标先暂存、校验、审计再提交 |
| 登记 | `skm sources add` / `skm sources wizard` | 按安装实例记录来源；用 `--tool`、`--scope`、`--instance` 或 `--all` 消除同名歧义 |
| 更新 | `skm update <skill>` | 展示文件新增/修改/删除，策略阻断高危包，然后原子替换所选实例；无变化不建备份 |
| 回滚 | `skm rollback <skill>` | 恢复实例隔离的完整包快照；恢复前备份当前包，因此可反向恢复 |
| 锁定 | `skm lock` / `skm lock diff` / `skm lock verify` | v3 锁文件记录安装身份、版本、来源、git HEAD、`SKILL.md` hash 和整包 hash |
| 策略 | `skm policy init/check` | 用本机策略检查 skill 总量、从未使用比例、重复安装、来源覆盖和安全发现 |
| 场景 | `skm profile create/apply` | 保存一组 Claude Code skill 状态，并可按写作、开发、设计等场景切换；应用前会备份设置 |
| 评测 | `skm eval [skill]` | 从描述、frontmatter、来源、重复、上下文开销、使用和安全信号打分 |
| 复盘 | `skm history [skill]` | 查看 skm 记录的安装、更新、回滚、锁定、策略和 profile 事件 |

推荐顺序是：先 `skm scan`，再补来源，之后 `skm lock` 建基线；后续用 `lock diff/verify` 检查漂移。同名安装是不同身份，模糊写操作会拒绝执行，需用 `--tool`、`--scope` 或 `--instance` 精确选择；`--all` 才会明确处理全部匹配项，并分别使用各自来源。仓库/目录来源会包含 `scripts/`、`references/`、assets 等全部包文件；直链 `SKILL.md` 是兼容路径，更新时保留现有附属文件。写入前会暂存并校验全部候选，扫描包内文本/代码文件，经高危策略门禁后建立实例级备份，再用目录重命名原子替换。插件管理的 skill 拒绝直接更新；软链 skill 更新真实目录并保留软链。只有人工复核高危证据后才应显式添加 `--allow-risk`。

### skill 状态治理

当 skill 太多时，最佳处理顺序不是删除，而是先降载、再禁用、最后才考虑人工删除。`skm state plan` 会基于重复安装、真实使用频率、长期未用和上下文开销，给出一份只读治理计划：

```bash
skm state plan
skm state plan --json
```

| 状态 | 含义 | 适合场景 |
|---|---|---|
| `on` | 正常启用 | 常用、近期用过、无明显上下文负担 |
| `name-only` | 只保留名称级可见性 | 偶尔用、但描述较长或长期未用 |
| `user-invocable-only` | 仅用户明确点名时可用 | 从未用过且上下文开销高，但还不想彻底关掉 |
| `off` | 原生关闭 | 重复安装且从未使用，或你确认不用 |
| 目录软禁用 | `skm disable <skill>` 把目录改名为 `_disabled-*` | AIDE 原生状态不可用时的可逆兜底 |

Claude Code 可写入原生状态：

```bash
skm state list
skm state set baoyu-image-gen --tool claude --mode name-only
skm state set old-skill --tool claude --mode off --scope user
```

写入时会修改 Claude Code 的 `skillOverrides`，修改前备份，默认需要输入 `yes` 确认；`--dry-run` 只看计划。Claude Code 的官方状态名是 `user-invocable-only`。Codex 当前建议继续使用内置 `/skills` 里的 Enable/Disable Skills 交互界面，skm 不猜测或改写未稳定公开的状态文件。

## 安全边界

默认命令以只读为主。`status`、`audit`、`risks`、`sessions`、`lock`、`policy`、`profile create`、`history` 等命令可能更新 `~/.skill-manager` 下的 skm 自身索引、缓存、锁定文件、策略、profile、历史和审计归档，但不会改 Claude Code、Codex、Cursor、Gemini 的配置、skill、MCP 或会话日志。显式运行 `skm setup`、`skm install`、`skm update`、`skm rollback`、`skm profile apply` 或源码安装脚本是例外：它们会写入支持的用户 skill 目录或 Claude Code 设置。

安全审计是静态、保守的：读取 `SKILL.md` 和包内文本/代码文件，以及 MCP 的非 `env` 配置字段；不执行 skill/MCP，不输出 env 值。`outdated --online` 对已登记仓库/目录来源比较整包 hash，对直链 `SKILL.md` 比较版本与内容，结果缓存 24 小时。`skm sources` 只写入 v2 本地来源表，可保存实例级记录，不修改已安装文件。使用频率仍只依赖可观测日志，其他适配器不会为了补数字推断调用次数。

CLI 内只有以下动作会修改 AIDE 文件：

| 动作 | 改动内容 | 防护 |
|---|---|---|
| `setup` | 安装 `skill-navigator` 到用户 skill 目录 | 显式命令；目标已有不同内容时先备份再替换；支持 `--dry-run` |
| `install <源>` | 安装 skill 到用户 skill 目录 | 显式命令；安装前静态审计；目标已存在时拒绝覆盖；默认需确认；支持 `--dry-run` |
| `update <skill>` | 替换已安装 skill | 需要有可读取来源；更新前备份原目录；默认需确认；支持 `--dry-run` |
| `rollback <skill>` | 用 skm 备份恢复 skill | 回滚前再备份当前目录；默认需确认；支持 `--dry-run` |
| `profile apply <名称>` | 写入 Claude Code `skillOverrides` | 只写 Claude Code 用户级设置；修改前备份；默认需确认；支持 `--dry-run` |
| `state set <skill>` | 写入 Claude Code `skillOverrides` | 仅支持 Claude 原生状态；自动备份；需确认；支持 `--dry-run` |
| `sessions --clean` | 删除会话日志文件 | 必须给保留策略；先打印计划；交互确认或 `--yes`；24 小时内活跃会话永不删；删除前聚合统计 |
| `disable/enable <skill>` | 重命名 skill 目录 | 完全可逆，不删除文件；插件 skill 拒绝处理；支持 `--dry-run` |
| `disable/enable --mcp` | 修改 `~/.claude.json` / `config.toml` | 自动备份；需确认；恢复时不覆盖用户手动重建的同名配置；支持 `--dry-run` |

更完整的写操作边界见 [docs/safety.md](docs/safety.md)。

## 在 AIDE 内使用

`skm setup` 会安装 `skill-navigator`：

```bash
~/.claude/skills/skill-navigator
~/.codex/skills/skill-navigator
```

这个薄入口 skill 是 Claude Code / Codex 与本项目之间的桥梁：之后你可以直接在对话里问“我要做 XX 该用哪个 skill”，编程助手应通过本机 `skm` 命令读取清单、审计和推荐结果，而不是手动扫描目录。升级后重新运行 `skm setup` 即可刷新桥接 skill。

可发布到 skill hub 的独立目录是 [integrations/skill-navigator](integrations/skill-navigator)。提交平台时建议填写 GitHub 源码 URL 作为唯一真源；如果平台支持索引 GitHub，后续更新会跟随仓库发布。支持 CLI/token 的平台可走 [docs/skill-publishing.md](docs/skill-publishing.md) 中的手动触发 workflow，无法自动索引的平台再按发布台账手动更新。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/usage.md](docs/usage.md) | 完整命令手册与示例 |
| [docs/recommend.md](docs/recommend.md) | skill 推荐逻辑、参数和增强模式 |
| [docs/graph.md](docs/graph.md) | 知识图谱关系、交互和导出 |
| [docs/report.md](docs/report.md) | HTML 总览报告 |
| [docs/safety.md](docs/safety.md) | 只读边界、写操作防护、数据说明 |
| [docs/lifecycle.md](docs/lifecycle.md) | skill 全生命周期治理命令 |
| [docs/release.md](docs/release.md) | npm Trusted Publishing 发布流程 |
| [docs/skill-publishing.md](docs/skill-publishing.md) | skill-navigator 平台发布流程 |
| [docs/roadmap.md](docs/roadmap.md) | 项目路线图与近期优先级 |
| [CONTRIBUTING.en.md](CONTRIBUTING.en.md) / [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献方式、本地开发、提交流程 |
| [SECURITY.md](SECURITY.md) | 安全报告方式与敏感数据提醒 |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | 社区行为规范 |

## 语言与跨端支持

**macOS / Windows：** 需要时在 GitHub Actions 页面手动触发验证。**Linux：** 由维护者在本机使用同一套只读构建与测试命令完成验证，避免触碰用户环境数据。

```bash
npm run check
npm test
npm pack --dry-run --registry=https://registry.npmmirror.com
```

`skm help`、参数校验、`doctor`、`scan`、`setup`、`status`、`risks`、`report`、`web`、`list`、`search`、`recommend`、`ask`、`outdated`、`sources`、`state`、`install`、`update`、`rollback`、`lock`、`policy`、`profile`、`eval`、`history`、`graph`、`dupes`、`audit`、`sessions`、`disable`、`enable` 和本地安装脚本已支持英文 / 简体中文输出。

可使用 `--lang en`、`--lang zh-CN`，或环境变量 `SKM_LANG=en`。JSON 字段名保持稳定。

手动验证入口：[GitHub Actions / macOS / Windows 验证](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml)。

## 平台成熟度矩阵

| 平台 | skill 扫描 | MCP 扫描 | 使用审计 | 状态治理 | 生命周期治理 | 说明 |
|---|---|---|---|---|---|---|
| Claude Code | 完整 | 完整 | 完整 | 可写原生 `skillOverrides` | 支持用户 skill 目录安装、更新、回滚 | 当前最完整适配对象 |
| Codex CLI | 完整 | 完整 | 完整 | 提示使用原生 `/skills` UI | 支持用户 skill 目录安装、更新、回滚 | 不猜测未稳定公开的状态文件 |
| Cursor | 保守扫描 | 常见配置扫描 | 暂无真实使用统计 | 暂不写状态 | 支持常见用户 skill 目录安装 | 不读取敏感编辑器缓存 |
| Gemini | 保守扫描 | 常见配置扫描 | 暂无真实使用统计 | 暂不写状态 | 支持常见用户 skill 目录安装 | 等待稳定公开日志格式后再扩展 |
| WorkBuddy | 目录扫描 | 暂无 | 暂无真实使用统计 | 暂不写状态 | 支持用户 skill 安装、更新、回滚 | 生命周期写操作使用相同整包防护 |
| Kimi | 兼容目录扫描 | 暂无 | 暂无真实使用统计 | 暂不写状态 | 支持多个用户目录安装、更新、回滚 | 按真实路径去重兼容目录 |

“完整”表示当前有可观测、可测试的本机数据来源；“保守扫描”表示只读取常见目录和非敏感配置，不为了凑数字推断真实使用次数。

## Roadmap

- 更强的知识图谱聚类、布局和导出样式
- 在当前 Cursor / Gemini 保守扫描基础上，等待其公开稳定的使用日志格式后再扩展真实使用审计
- 在当前 MCP schema 静态估算基础上继续做逐 server 实测

完整路线图见 [docs/roadmap.md](docs/roadmap.md)。

## 参与项目

如果这个工具帮你看清了自己的 skill 目录，欢迎在 [GitHub](https://github.com/GrubbyLee/skill-manager) 点 Star。也欢迎提交 Issue：晒一晒你的 `skm scan` 结果、反馈误分类、补充新的 AIDE 适配器、提出新的治理场景。

更轻量的交流可以到 [Discussions](https://github.com/GrubbyLee/skill-manager/discussions)：分享图谱截图、讨论 Roadmap，或看看其他人的 skill 目录。

## 许可证

[MIT](LICENSE)
