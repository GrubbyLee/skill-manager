# skill-manager（skm）

[![macOS / Windows 验证](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml)

> 一间堆满工具的工作室里，Claude Code 和 Codex 各自抱着一箱 skill。
> 有的工具重复，有的很久没被拿起，有的名字像谜语，有的 MCP 一开场就把上下文塞满。
> `skm` 做的事很简单：把灯打开，把标签贴好，把灰尘扫出来。

`skm` 是一个清点、梳理并治理 AIDE（Claude Code / Codex CLI）中 skill 与 MCP 的命令行工具。它会告诉你：

- 你现在到底装了多少 skill / MCP
- 哪些能力重复、哪些目录只是软链共享、哪些是实体双份
- 哪些 skill 从未真正用过
- 做某件事时，应该优先用哪个 skill
- 哪些 MCP 可能在白白消耗上下文
- 会话日志占了多少空间，能安全释放多少

默认只读，零第三方依赖，仅需 Node.js >= 18。只有 `sessions --clean`、`disable`、`enable` 三类动作会写文件，且都有确认、备份或安全窗口。

![skm 演示](docs/demo.png)

## 这是一部四格小漫画

| 分镜 | 画面 | skm 在做什么 |
|---|---|---|
| 第 1 格：工具间太满了 | 两个工具箱同时倒出来：`baoyu-*`、`lark-*`、`gsap-*`、一堆 MCP | `skm scan` 扫描 Claude Code / Codex，生成统一目录 |
| 第 2 格：标签贴起来 | 每个 skill 被贴上“图像与视觉”“办公协作”“内容转换”等标签 | `skm list`、`skm search`、`skm graph` 帮你看清能力版图 |
| 第 3 格：关系亮起来 | skill 变成星图，分类、同源、流程和平台关系连成线 | `skm graph` 生成可筛选、可拖动的知识图谱 |
| 第 4 格：该收纳了 | 重复的放一边，没用过的标出来，日志按工作区排好 | `skm dupes`、`skm audit`、`skm sessions` 给出清理建议 |

> 下面的漫画是功能意象图，具体命令和真实数据以终端输出为准。

| 工具间太满了 | 扫描贴标签 |
|---|---|
| ![工具间太满了](docs/comic-01-tool-chaos.jpg) | ![扫描贴标签](docs/comic-02-scan-labels.jpg) |

| 知识图谱亮起来 | 安全收纳 |
|---|---|
| ![知识图谱亮起来](docs/comic-03-knowledge-map.jpg) | ![安全收纳](docs/comic-04-safe-cleanup.jpg) |

## 它能帮你做什么

- **双工具覆盖**：同时扫描 Claude Code（用户级 / 项目级 / 插件自带 skill、`~/.claude.json` 与 `.mcp.json` 的 MCP）和 Codex（`~/.codex/skills`、`config.toml` 的 MCP）
- **软链感知**：正确处理指向共享库（如 `~/.agents/skills`）的符号链接，区分"软链共享一份实体"与"实体双份拷贝"
- **规则分类**：内置中文分类规则（可通过 `~/.skill-manager/rules.json` 扩展/覆盖），未分类率趋近 0
- **任务推荐**：直接输入“我要做什么”，推荐最合适的 skill，结合中文任务意图、文本相关性、转换方向、历史使用、最近使用与两侧可用性
- **知识图谱**：把 skill / MCP / 分类 / 同源套件 / 平台关系导出为 JSON、Mermaid 或单文件 HTML 可视化图谱，支持搜索聚焦、重点节点、标签开关和节点拖动
- **环境诊断**：`skm doctor` 一次检查 Node 版本、目录、catalog、advisor CLI、macOS/Windows CI 等开源项目运行条件
- **风险报告**：`skm risks` 汇总重复安装、闲置 MCP、高上下文开销、会话日志体积和不可观测项
- **四级重复检测**：同名多处安装 → 异名同内容 → 同类多实现 → 文本高度相似
- **使用审计**：解析两侧会话日志统计每个 skill / MCP 的真实使用频率，识别从未使用的僵尸项，快照自动归档
- **会话治理**：按工作区查看会话日志分布，按保留策略安全清理（确认式，统计先聚合再删除）
- **默认只读**：仅 `sessions --clean` / `disable` / `enable` 三个动作改动文件，均有确认与备份防护（见下文"写操作边界"）
- **零第三方依赖**：不依赖任何 npm 包，全部功能基于 Node.js 内置模块实现；唯一的运行环境要求是 Node.js ≥ 18

## 开箱

```bash
# 源码安装（GitHub 主仓；国内可用 Gitee 镜像 https://gitee.com/synovation/skill-manager）
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
npm link        # 之后可全局使用 skm 命令；不想 link 就用 node bin/skm.js
```

开箱后三步：

```bash
skm scan       # 先清点工具箱
skm            # 再看健康体检
skm graph --format html --output skill-graph.html  # 最后打开知识图谱
```

## 读图指南

以下示例均为真实运行输出（表格截取前几行，工作区路径已泛化）。所有命令都支持 `--json` 输出供脚本或 AI 消费；输出在终端中带颜色高亮（管道/重定向时自动关闭，遵守 `NO_COLOR` 约定）。

### 你现在遇到的是哪一幕

| 当前画面 | 直接运行 | 会看到什么 |
|---|---|---|
| “我这台机器能不能正常跑？” | `skm doctor` | Node、目录、catalog、advisor、CI 状态 |
| “我到底装了多少东西？” | `skm scan` | 两侧 skill / MCP 数量、分类分布、上下文估算 |
| “启动越来越慢，先看哪里？” | `skm` | 健康分、僵尸率、重复安装、闲置 MCP、会话体积 |
| “哪些项对用户有风险？” | `skm risks` | 分级风险清单和保守处理建议 |
| “做这件事该用哪个 skill？” | `skm ask "把网页转成 markdown"` | 首选 skill、理由、备选 |
| “这些 skill 之间有什么关系？” | `skm graph --format html --output skill-graph.html` | 可筛选、可拖动的单文件知识图谱 |
| “哪些是重复或该收纳的？” | `skm dupes && skm audit` | 四级重复检测、真实使用频率、清理建议 |
| “日志太大了，能不能瘦身？” | `skm sessions --clean --days 30 --keep 3 --dry-run` | 删除计划，不会真的删 |

### 命令速查表

| 命令 | 用途 | 常用选项 / 说明 |
|---|---|---|
| `skm` / `skm status` | 一屏健康体检：总量、僵尸率、重复、会话体积、健康分与建议 | `--json` 输出结构化结果 |
| `skm doctor` | 只读环境诊断：Node、目录、catalog、advisor CLI、macOS/Windows CI | `--json` |
| `skm risks` | 只读风险报告：重复、闲置、高上下文开销、日志体积、MCP 可观测性 | `--json` |
| `skm scan` | 扫描 Claude Code / Codex 的 skill 与 MCP，重建 `~/.skill-manager/catalog.json` | `--verbose` 显示解析警告 |
| `skm list` | 按分类列出 skill，默认合并两侧同名项 | `--category <关键字>`、`--tool claude\|codex`、`--scope user\|project\|plugin`、`--raw` |
| `skm list --mcp` | 列出 MCP server | `--tool claude\|codex`、`--json` |
| `skm search <词>` | 搜索名称、分类、描述，回答“该用哪个 skill” | 支持多个关键词；`--json` |
| `skm recommend <任务>` | 根据自然语言任务描述推荐最合适的 skill | `--top <N>`、`--tool claude\|codex`、`--category <关键字>`、`--why`、`--advisor codex\|claude`、`--json` |
| `skm ask <任务>` | 以问答口吻给出首选 skill、理由和备选 | `--tool claude\|codex`、`--category <关键字>`、`--json` |
| `skm graph` | 展示或导出 skill / MCP 知识图谱 | `--format json\|html\|mermaid`、`--output <文件>` |
| `skm dupes` | 四级重复检测：同名安装、同内容、同类多实现、文本相似 | `--json` |
| `skm audit` | 使用频率、僵尸 skill、MCP 使用、上下文开销审计 | `--history` 看归档；`--json` |
| `skm sessions` | 按工作区查看 Claude/Codex 会话日志分布 | `--json` |
| `skm sessions --clean` | 按保留策略清理会话日志 | 必须配 `--days <N>` 和/或 `--keep <N>`；先用 `--dry-run`；脚本模式加 `--yes` |
| `skm disable <名>` | 软禁用 skill（目录加 `_disabled-` 前缀，可逆） | 可一次传多个名称 |
| `skm enable [名]` | 恢复 skill；不带名称时列出已禁用项 | 可一次传多个名称 |
| `skm disable --mcp <名>` | 禁用 MCP（修改配置前自动备份） | 需确认；可一次传多个名称 |
| `skm enable --mcp <名>` | 恢复被 skm 禁用的 MCP | 需确认；遇到用户已手动重建的同名配置会跳过不覆盖 |
| `skm help` | 查看内置帮助 | 同 `skm -h` |

### 一般排查流程：从“乱”到“清楚”

当你觉得 skill / MCP 太多、启动变慢、重复安装难以判断，或会话日志占用过大时，建议按下面顺序排查：先刷新事实，再看整体，再定位重复与闲置，最后才执行可逆禁用或清理。

```bash
# 0. 先看本机运行环境是否完整
skm doctor

# 1. 刷新目录：新装 / 删除 / 移动 skill 后先跑一次
skm scan

# 2. 看整体健康体检：总量、僵尸率、重复安装、闲置 MCP、会话体积与建议
skm

# 3. 看分级风险清单：它会告诉你哪些项最值得先处理
skm risks

# 4. 查重复：区分软链共享、实体双份、同内容复制、同类多实现
skm dupes

# 5. 查真实使用频率：确认哪些 skill 从未使用、哪些最近没再用
skm audit

# 6. 查 MCP：先看装了哪些，再结合 audit 判断 Claude 侧是否闲置
skm list --mcp
skm audit

# 7. 查会话日志体积：按工作区看 Claude / Codex 日志分布
skm sessions

# 8. 清理日志必须先 dry-run，看清楚计划再执行
skm sessions --clean --days 30 --keep 3 --dry-run

# 9. 确认后再做软禁用（可逆）；MCP 会改配置，执行前会备份并要求确认
skm disable <skill名>
skm disable --mcp <MCP名>
```

排查时优先处理“实体双份 + 从未使用”的 skill，以及 Claude 侧从未调用过的 MCP。只想浏览事实时停在第 7 步即可；第 8、9 步属于写操作，建议确认报告无误后再执行。

### 第 1 话：`skm` —— 一屏健康体检

不带任何参数直接运行 `skm`，得到当前 AIDE 的整体健康状况与可直接复制执行的建议：

```
$ skm
📊 skill 健康体检（目录扫描于今天，过期可 skm scan）
  能力总量    165 个 skill / 6 个 MCP
  僵尸 skill  105 个从未使用（64%）
  重复安装    40 组实体双份
  闲置 MCP    drawio
  会话日志    1.8GB（按 30 天 ∪ 留 3 个策略可释放 219.2MB）
  健康分      35 / 100

建议
  1. 双份且从未使用 20 个，最优先清理：skm disable baoyu-compress-image baoyu-cover-image …（先清前 5 个，完整清单见 skm audit --json）
  2. 禁用闲置 MCP：skm disable --mcp drawio
  3. 会话瘦身（先看计划）：skm sessions --clean --days 30 --keep 3 --dry-run
  4. 完整报告：skm audit（使用频率与僵尸清单） | skm dupes（重复明细）
```

健康分为 0-100 的启发式评分：僵尸率最高扣 40 分，实体双份每组扣 1 分（上限 20），闲置 MCP 每个扣 5 分（上限 15），会话日志每 GB 扣 10 分（上限 15）。上例中双份与日志两项均已触顶，故为 100−26−20−5−15=35 分（说明：闲置 MCP 的判定只依据 Claude 侧的调用记录，仅在 Codex 侧配置的 MCP 无法观测、不会被建议禁用）。评分用于自我对比与清理前后的量化反馈。

### 第 1.5 话：`skm doctor` / `skm risks` —— 开源项目级自检

如果你是第一次安装，或准备把当前机器的 skill 状态作为 issue / discussion / 使用反馈发出来，建议先跑：

```bash
skm doctor
skm risks
```

`doctor` 只检查运行环境，不解析会话日志，也不会改任何文件：

```
$ skm doctor
skm 环境诊断

项目                    状态    说明
──────────────────────  ──────  ─────────────────────────────────────
Node.js 版本            正常    当前 24.14.0，要求 >= 18
零第三方依赖            正常    dependencies 为空
ES Modules              正常    type=module
skm 命令入口            正常    ./bin/skm.js
扫描目录                正常    165 个去重 skill / 205 条安装记录 / 6 个 MCP，扫描于 2026-07-20 02:59（昨天）
codex advisor           正常    codex-cli 版本信息
claude advisor          正常    Claude Code 版本信息
macOS/Windows CI        正常    .github/workflows/ci.yml 已存在
```

`risks` 是只读风险报告，会汇总“最值得先处理”的问题，但不会直接禁用或删除：

```
$ skm risks
正在汇总风险信号（使用统计、MCP、会话日志）…
skm 风险报告（风险分 70 / 100，越高越安全）

等级    风险项                    数量      建议
──────  ────────────────────────  ────────  ─────────────────────────────────
高      双份且从未使用            20        先核对 skm audit 与 skm dupes，再考虑 skm disable ...
中      实体双份安装              40        运行 skm dupes 查看软链共享、同内容复制与内容不同的明细
中      Claude 侧闲置 MCP         1         确认不用后可 skm disable --mcp drawio
低      90 天以上未用             8         结合 skm audit 判断是否归档或禁用
信息    仅 Codex 侧 MCP           2         当前无法从 Claude 日志观测，不据此建议禁用
```

风险等级口径：

- **高**：实体双份且从未使用，通常是最优先治理对象
- **中**：重复安装、闲置 MCP、高上下文开销、日志体积较大
- **低**：长期未用、description 缺失等质量问题
- **信息**：当前不可观测或不应直接给禁用建议的事实

这两个命令适合附在 issue / discussion 中：`doctor` 说明环境是否正常，`risks --json` 可提供结构化风险数据。

### 第 2 话：`skm scan` —— 给工具箱做点名

扫描两侧全部 skill 与 MCP，生成 `~/.skill-manager/catalog.json`。选项：`--verbose` 显示全部解析警告。

```
$ skm scan
扫描完成 ✓

扫描概览
工具          skill   用户    项目    插件    MCP    已归档    上下文估算
────────────  ──────  ──────  ──────  ──────  ─────  ────────  ────────────────
Claude Code   87      72      0       15      6      0         约 9529 token
Codex         118     118     0       0       3      2         约 10577 token

汇总
指标                      数值
────────────────────────  ──────────────────────────────
去重后 skill              165 个
两侧同名安装              40 个
解析警告                  0 条
目录文件                  ~/.skill-manager/catalog.json

分类分布
分类                      数量
────────────────────────  ─────
办公协作（飞书）          25 个
内容抓取与转换            15 个
第三方服务集成            15 个
图像与视觉                14 个
…

说明：已归档目录指名称以 _ 或 . 开头、扫描时未计入的目录。

目录已写入 ~/.skill-manager/catalog.json
```

### 第 3 话：`skm list` —— 把工具按抽屉摆好

按分类列出全部 skill（默认合并两侧同名条目）。选项：`--category <关键字>` 按分类过滤、`--tool claude|codex`、`--scope user|project|plugin`、`--mcp` 列 MCP、`--raw` 逐条显示安装记录不合并。

```
$ skm list --category 发布

【发布分发】（4）
名称                  工具    描述
────────────────────  ──────  ────────────────────────────────────────────────
baoyu-post-to-wechat  两侧    Posts content to WeChat Official Account (微信公众号)…
baoyu-post-to-weibo   两侧    Posts content to Weibo (微博). Supports regular posts…
baoyu-post-to-x       两侧    Posts content and articles to X (Twitter). Supports…
wechat-to-markdown    codex   Fetch WeChat Official Account (微信公众号) articles…

共 4 个 skill（扫描时间：2026-07-18 23:09，过期可重新 skm scan）
```

### 第 4 话：`skm search` —— 记不住名字也能找

在名称/分类/描述中匹配（名称命中权重最高），回答"做某件事该用哪个 skill"。

```
$ skm search 转 markdown
名称                        工具    分类            描述
──────────────────────────  ──────  ──────────────  ────────────────────────────────
baoyu-danger-x-to-markdown  两侧    内容抓取与转换  Converts X (Twitter) tweets and…
baoyu-format-markdown       两侧    内容抓取与转换  Formats plain text or markdown…
baoyu-markdown-to-html      两侧    内容抓取与转换  Converts Markdown to styled HTML…
baoyu-url-to-markdown       两侧    内容抓取与转换  Fetch any URL and convert to…
wechat-to-markdown          codex   发布分发        Fetch WeChat Official Account…
```

### 第 5 话：`skm recommend` / `skm ask` —— 直接问“该用哪个”

当你只知道“我要做什么”，但不确定该用哪个 skill 时，优先使用 `skm recommend` 或 `skm ask`。默认情况下，这两个命令不调用外部模型，不上传任何目录信息，只基于本机扫描目录与使用统计做本地启发式推荐。

推荐排序会综合以下信号：

- **文本相关性**：匹配目录名、frontmatter `name`、分类、description
- **中文同义词**：例如“小红书”会扩展到 `xhs` / `image cards`，“网页”会扩展到 `url` / `web`
- **任务意图**：识别“漫画/分镜”“知识图谱”“排查/诊断”“演示文稿”“会议纪要”等中文任务类型，优先匹配专用 skill
- **转换方向**：识别 `markdown to html`、`html to markdown`、`网页转 markdown`，避免推荐反向 skill
- **使用记录**：历史用过、最近 30/90 天用过的 skill 会加权，但不会让不相关的热门 skill 混入
- **可用范围**：Claude/Codex 两侧都可用的 skill 会优先
- **可选增强**：显式传 `--advisor codex` 或 `--advisor claude` 时，会把精简候选清单交给本机 AIDE CLI 做语义判断

`recommend` 输出排序表，适合快速比较；`ask` 输出首选、理由和备选，适合直接问“该用哪个”。

```
$ skm recommend "把网页转成 markdown"
正在结合目录与使用统计生成推荐…
推荐任务：把网页转成 markdown

推荐  名称                        工具    分类            最近使用    理由
────  ──────────────────────────  ──────  ──────────────  ──────────  ─────────────────────────────
1     baoyu-url-to-markdown       两侧    内容抓取与转换  3 天前      名称高度匹配；描述匹配；历史用过 8 次；最近 30 天用过
2     baoyu-markdown-to-html      两侧    内容抓取与转换  —           名称高度匹配；分类匹配；Claude/Codex 两侧可用
3     baoyu-format-markdown       两侧    内容抓取与转换  12 天前     名称高度匹配；历史用过 2 次；最近 30 天用过

提示：recommend 是本地启发式推荐；复杂任务可结合 skm search 与 skm audit 交叉确认。
```

查看详细命中词与分数：

```
$ skm recommend "把网页转成 markdown" --why
推荐任务：把网页转成 markdown

推荐  分数   名称                          工具    最近使用    命中 / 理由
────  ─────  ────────────────────────────  ──────  ──────────  ─────────────────────────────────────
1     58     baoyu-url-to-markdown         两侧    6 天前      命中 markdown, url, web；方向匹配：url → markdown；…
2     32     baoyu-danger-x-to-markdown    两侧    —           命中 markdown, url；目标匹配：markdown；…
```

问答式推荐：

```
$ skm ask "把网页转成 markdown"
任务：把网页转成 markdown

首选：baoyu-url-to-markdown（两侧，内容抓取与转换）
理由：方向匹配：url → markdown；名称高度匹配；描述匹配；Claude/Codex 两侧可用；最近 30 天用过。

备选：
  - baoyu-danger-x-to-markdown：目标匹配：markdown；名称高度匹配；描述匹配
  - wechat-to-markdown：目标匹配：markdown；名称高度匹配；任务词相似
```

常用参数：

| 参数 | 作用 | 示例 |
|---|---|---|
| `--top <N>` | 指定推荐数量（最多 20） | `skm recommend "生成封面图" --top 5` |
| `--tool claude\|codex` | 只推荐某一侧可用的 skill | `skm recommend "小红书图片卡片" --tool codex` |
| `--category <关键字>` | 限制分类范围 | `skm recommend "封面图" --category 图像` |
| `--why` | 显示分数、命中词、方向识别 | `skm recommend "markdown to html" --why` |
| `--advisor codex\|claude` | 显式调用本机 Codex / Claude Code 做增强推荐；失败时回退本地推荐 | `skm recommend "生成知识图谱" --advisor codex` |
| `--json` | 输出结构化结果，供 AI 或脚本消费 | `skm recommend "写邮件" --json` |

增强推荐的边界：

- 不增加 npm 依赖，只使用 Node.js 内置 `child_process` 调用本机已有 CLI
- 只在显式传 `--advisor` 时触发；默认推荐仍然完全本地、离线、可测试
- 发送给 advisor 的是精简候选清单：skill 名称、分类、工具来源、description、使用次数、本地分数与理由
- 不发送 skill 路径、真实配置路径、MCP `env` 值、API Key、密码或密钥文件
- 如果 `codex` / `claude` 不在 PATH、未登录、网络不可用或调用超时，会提示原因并回退到本地推荐

推荐功能可以这样自测：

```bash
skm recommend "markdown to html" --why
skm recommend "html to markdown" --why
skm recommend "做小红书图片卡片" --tool codex --category 图像 --top 2
skm recommend "给 README 做四格漫画分镜" --why
skm recommend "生成漂亮的知识图谱" --why
skm recommend "生成漂亮的知识图谱" --advisor codex --why
skm ask "把网页转成 markdown"
skm recommend "生成封面图" --category 图像 --json
```

### 第 6 话：`skm dupes` —— 找出影分身

```
$ skm dupes
一、同名多处安装（40 组）
  baoyu-comic  [claude/user + codex/user]  内容完全相同，可考虑软链化或保留一份
  baoyu-cover-image  [claude/user + codex/user]  内容完全相同，可考虑软链化或保留一份
  …

二、名字不同但内容完全相同（0 组）
  无

三、同类多实现（15 个分类存在多套实现，做同一类事时需选择）
  【图像与视觉】共 14 个：baoyu-*（6 个） | graphify | canvas-design | gpt-image-2 | …
  【设计与 UI】共 13 个：grill-me | huashu-design | ui-ux-pro-max | brainstorming | …
  …

四、名称+描述文本高度相似，疑似换名复制（阈值 0.4，显示前 15）
  60%  connect  ↔  connect-apps
```

一级会区分三种结论：软链共享同一实体（无需处理）/ 内容完全相同（可软链化）/ 内容不同（需先对比）。

### 第 7 话：`skm graph` —— 把 skill 画成地图

把已安装的 skill、MCP、分类、同源套件和平台生态关系构造成知识图谱。默认显示摘要；需要可视化或二次处理时可导出为 JSON、Mermaid 或单文件 HTML。

图谱节点包括：

- `skill`：合并后的 skill 能力节点，带分类、工具来源、使用次数、最近使用、上下文估算等信息
- `mcp`：MCP server 节点，带工具来源、transport、使用次数
- `category`：分类节点，用于展示同类能力聚合
- `family`：同源套件节点，例如 `baoyu-*`、`lark-*`、`gsap-*`
- `platform`：共享平台节点，例如 WeChat、Lark、GitHub、X / Twitter、OpenAI

关系边包括：

| 关系 | 详细含义 | 适合用来判断什么 |
|---|---|---|
| 同源 | 目录名前缀相同，通常表示同一作者、同一套工具包或同一组能力，例如 `baoyu-*`、`lark-*`、`gsap-*`。 | 哪些 skill 是成组安装的套件；一组里是否有明显冗余 |
| 同类 | 根据分类规则归入同一业务类别，表示用途相近，但不一定互相依赖。 | 某一类能力是否过多；做同类任务时有哪些候选 |
| 重复 | 不同安装记录的 `SKILL.md` 内容哈希完全相同，表示实质上是同一份 skill。 | 是否可以保留一份、软链化或禁用重复项 |
| 替代 | 同分类下名称或描述高度相似，但不属于同一前缀组。 | 哪些 skill 可能互为替代，适合比较保留哪一个 |
| 流程 | 一个 skill 的输出格式可以作为另一个 skill 的输入格式，例如 URL 转 Markdown 后再转 HTML。 | 哪些 skill 可以串成工作流 |
| 反向转换 | 两个 skill 的转换方向相反，例如 Markdown 转 HTML 与 HTML 转 Markdown。 | 哪些 skill 是互补工具，而不是简单重复 |
| 共享平台 | 名称或描述命中同一外部平台关键词，例如 GitHub、飞书、Notion、WeChat。 | 按平台查看生态；识别某个平台相关 skill 是否过多 |
| 使用 MCP | skill 描述中同时命中 MCP 与具体 MCP server 名称，表示它可能依赖或调用该 MCP 能力。 | 哪些 skill 可能与某个 MCP server 相关 |

```
$ skm graph
正在构建 skill 知识图谱…
skill 知识图谱

节点/关系             数量
────────────────────  ─────────
skill 节点            165 个
MCP 节点              6 个
分类节点              16 个
同源组节点            13 个
平台节点              15 个
关系边                344 条
目录扫描时间          2026-07-19 23:10

关系分布
关系                数量
──────────────────  ─────
同类                165 条
共享平台            92 条
同源                81 条
流程                5 条
替代                1 条
```

导出单文件 HTML 图谱：

```bash
skm graph --format html --output skill-graph.html
# Linux 桌面可直接打开；也可以在文件管理器或浏览器中打开
xdg-open skill-graph.html
```

图谱效果示例：

![skm skill 知识图谱示意图](docs/graphic.png)

导出结构化数据或 Mermaid：

```bash
skm graph --format json --output skill-graph.json
skm graph --format mermaid --output skill-graph.md
```

HTML 图谱是零依赖单文件，内联 SVG/CSS/JS，可直接用浏览器打开，不需要联网，也不会读取或上传额外数据。交互能力包括：

- **关系过滤**：左侧勾选哪些关系，右侧就只显示这些关系涉及的节点和连线；取消勾选后，不相关节点会一起隐藏，而不只是隐藏连线
- **默认聚焦高信号关系**：默认显示同源、重复、替代、流程、反向转换、使用 MCP；`同类` 和 `共享平台` 因数量通常较多，默认关闭，需要全量查看时再勾选
- **关系说明提示**：鼠标悬停左侧关系名称，例如“同源”“反向转换”“共享平台”，会弹出详细解释，说明该关系如何产生、适合判断什么
- **搜索聚焦**：搜索框会在当前勾选关系形成的子图中显示匹配节点及其一跳关系，避免只剩孤立节点
- **重点节点**：开启“只看重点节点”后，保留使用过、重复安装或关系较多的关键 skill，同时保留分类、同源组、平台、MCP 等结构节点
- **闲置隐藏**：开启“隐藏从未使用的 skill”后，可快速压缩大图，只看近期治理更值得关注的节点
- **标签开关**：节点太密时可以临时关闭文字标签，先看结构，再按需悬停查看详情
- **重置布局**：手工拖动节点后，可以一键回到初始布局
- **节点拖动**：右侧图谱节点可以直接拖动；拖动后相连线段会实时跟随，便于把密集区域手工拉开查看
- **悬停详情**：悬停节点或连线可查看来源、置信度、使用次数、最近使用、上下文估算等信息

图谱视觉规则：

- 节点大小与使用频率相关，越常用越大
- 从未使用的 skill 会变灰
- 两侧实体双份安装的 skill 会用红色边框强调
- 分类、同源组、平台、MCP 会使用不同颜色，方便区分结构节点与真实 skill 节点
- 画布会随 skill 数量自动变大，减少大量节点时的默认重叠

生成后在页面中这样查看：

- 只看套件关系：保留“同源”，关闭其他关系
- 查看可串联工作流：打开“流程”，必要时再打开“反向转换”
- 查看某个平台生态：打开“共享平台”，再在搜索框输入 `github`、`飞书`、`notion` 等关键词
- 图太密时：取消“同类”“共享平台”，开启“只看重点节点”或“隐藏从未使用的 skill”，也可以关闭标签、拖动右侧节点把密集区域拉开

### 第 8 话：`skm audit` —— 谁真的上过战场

解析两侧会话日志还原真实使用情况；每次运行自动归档快照，`--history` 查看历次归档。

```
$ skm audit
观察窗口：2026-05-19 起（以现存会话日志与已聚合的墓碑统计为准）

一、使用频率 Top 20（共 57 个 skill 被用过）
名称             次数   最近使用    分类
───────────────  ─────  ──────────  ────────────
baoyu-image-gen  117    3 天前      图像与视觉
ui-ux-pro-max    12     6 天前      设计与 UI
taste-skill      11     昨天        设计与 UI
…

二、僵尸 skill：从未使用 105 个（占 64%）
  【办公协作（飞书）】22 个：lark-approval、lark-attendance、…
  …

三、MCP 使用情况（使用信号来自 Claude 侧调用；仅 Codex 侧配置的无法观测）
名称              次数    最近使用
────────────────  ──────  ──────────
codex             13      今天
web-search-prime  10      12 天前
drawio            0       —
  ⚠ Claude 侧从未使用的 MCP：drawio —— MCP schema 全量注入上下文，建议优先禁用

四、常驻上下文开销 Top 10（name+description 估算）
  …

建议
  1. 双份且从未使用 20 个，最优先清理：skm disable baoyu-compress-image …（先清前 5 个，完整清单见 skm audit --json）
  2. 禁用闲置 MCP：skm disable --mcp drawio
  3. 清理前交叉核对重复明细：skm dupes
```

```
$ skm audit --history
归档时间           总数   在用   僵尸   文件
─────────────────  ─────  ─────  ─────  ──────────────────────────────
2026-07-18 18:32   165    57     108    audit-2026-07-18T10-32-20.json
2026-07-18 22:28   165    57     108    audit-2026-07-18T22-28-41.json
```

### 第 9 话：`skm sessions` —— 日志仓库大扫除

按工作区展示两侧会话日志（Claude 按目录归属，Codex 解析文件头 cwd）。

```
$ skm sessions
会话数  体积      最老        最新        工作区
──────  ────────  ──────────  ──────────  ─────────────────────
60      349.8MB   2026-04-14  2026-07-18  ~/codes/project-a
27      153.0MB   2026-05-21  2026-07-17  ~/codes/project-b
28      150.2MB   2026-07-05  2026-07-18  ~/codes/project-c
…
合计 555 个会话，1.8GB（Claude 126.2MB + Codex 1.6GB）
```

清理：`--clean` 配合 `--days <N>` 和/或 `--keep <N>`（两者取并集，宁多留不少留），先用 `--dry-run` 看计划，确认后去掉重跑；脚本模式加 `--yes`。

```
$ skm sessions --clean --days 30 --keep 3 --dry-run
清理计划（保留策略：每工作区最近 3 个 ∪ 30 天以内 ∪ 24小时内活跃）：

  ~/codes/project-a
    删除 41 个会话，释放 208.7MB（最新的一个止于 2026-06-15）
  …

共删除 76 个会话文件，释放 219.2MB。
删除前会先把这些日志的使用统计聚合进缓存（墓碑机制），因此不影响 skm audit 的累计数字。

[dry-run] 未执行删除。确认无误后去掉 --dry-run 重新运行。
```

### 第 10 话：`skm disable` / `skm enable` —— 先收起来，不急着丢

skill 禁用只是目录改名加 `_disabled-` 前缀（AIDE 不再加载），完全可逆；MCP 禁用会修改配置文件，修改前每个 MCP 独立备份并要求确认。

```
$ skm disable gsap-plugins
  已禁用 claude/user/gsap-plugins
  已禁用 codex/user/gsap-plugins

$ skm enable            # 不带参数列出所有已禁用项
当前已禁用 2 个 skill：
  gsap-plugins（claude/user）
  gsap-plugins（codex/user）

$ skm enable gsap-plugins    # 恢复

$ skm disable --mcp drawio
将禁用 MCP：drawio（会修改 AIDE 配置文件，修改前自动备份到 ~/.skill-manager/backups）
确认执行？输入 yes 继续，其他任意键取消：yes
  claude：已从 ~/.claude.json 移除 drawio（备份：~/.skill-manager/backups/claude.json.drawio.2026-07-18T22-29-07）
  codex：已禁用 config.toml 中的 [mcp_servers.drawio]（3 行，备份：…）
```

## 写操作边界

工具不修改 AIDE 的配置与 skill 文件（自身的目录、缓存与审计归档写在 `~/.skill-manager/`）；仅以下三个动作例外，且各有防护：

| 动作 | 改动内容 | 防护 |
|---|---|---|
| `sessions --clean` | 删除会话日志文件 | 必须显式给保留策略；先打印完整清理计划；交互确认或 `--yes`；24 小时内活跃的会话永不删；未知工作区只接受 `--days` 策略；删除前自动把待删日志的使用统计聚合进缓存（墓碑机制） |
| `disable/enable <skill>` | 仅重命名 skill 目录 | 完全可逆，不删任何文件；插件 skill 拒绝处理 |
| `disable/enable --mcp` | `~/.claude.json` / `config.toml` | 每个 MCP 每次操作独立备份（文件名含名称+时间戳，绝不互相覆盖）；Codex 侧只做行级注释可逐字节还原；enable 遇到用户已手动重建的同名配置时跳过不覆盖；需确认 |

## audit 的数据来源

- Claude Code：解析 `~/.claude/projects/**/*.jsonl` 中的 Skill 工具调用与斜杠命令记录，MCP 按 `mcp__<server>__` 工具调用计数
- Codex：解析 `~/.codex/sessions/**/*.jsonl`，**只统计 function_call 中实际读取 `SKILL.md` 的行为**（Codex 会把全部可用 skill 路径注入会话上下文，直接匹配路径会严重虚高，已规避），同一会话同一 skill 只计 1 次
- 流式逐行读取（恒定内存，GB 级单文件也不受 Node 字符串上限影响）；按文件大小+mtime 增量缓存（`~/.skill-manager/usage-cache.json`，v3），首轮约十秒，之后毫秒级
- 解析层不做名称过滤（过滤在消费侧），skill 晚于日志安装也能追溯到历史使用
- **墓碑机制**：日志文件被清理后，已聚合的统计并入常驻聚合桶永久保留；每次 audit 还会把快照归档到 `~/.skill-manager/audit-history/`
- 所有日期展示统一为 Asia/Shanghai 时区；数据文件内仍存 ISO/UTC

## 在 AIDE 内使用（推荐）

把薄入口 skill 装进任一/两个工具，之后直接问 AI"我要做 XX 该用哪个 skill"，模型会调用 `skm` 读取最新目录再回答：

```bash
cp -r integrations/skill-navigator ~/.claude/skills/    # Claude Code
cp -r integrations/skill-navigator ~/.codex/skills/     # Codex
```

## 自定义分类规则

创建 `~/.skill-manager/rules.json`（用户规则优先于内置规则；`overrides` 直接指定单个 skill 的分类）：

```json
{
  "rules": [
    { "category": "我的分类", "prefixes": ["my-"], "keywords": ["某关键词"] }
  ],
  "overrides": { "some-skill": "研发辅助" }
}
```

## 数据说明

- 扫描产物：`~/.skill-manager/catalog.json`，不含任何密钥/环境变量值（MCP 的 `env` 一律不读取）
- 上下文开销估算：skill 常驻部分只有 `name + description`（正文按需加载）；MCP 则是全量 tool schema 注入，治理收益更大
- 归档约定：目录名加 `_` 前缀即被扫描忽略（如 `_archived-xxx`）

## 跨端验证

本仓库通过 GitHub Actions 自动验证 macOS 与 Windows；Linux 由维护者在本机执行同一套检查，避免远端 CI 再额外跑 Linux 环境。每次 push 到 `main`、提交 Pull Request，或在 Actions 页面手动触发 `macOS / Windows 验证` workflow，都会在 macOS 与 Windows 上执行：

- `npm install --ignore-scripts`
- `npm run check`：用 Node.js 对 `bin` / `src` / `test` 下的 `.js` / `.mjs` 做语法检查
- `npm test`：运行全部 `node --test` 单元测试
- CLI smoke test：执行 `help`、`scan --json`、`doctor --json`、`risks --json`、`graph --format json/html`
- `npm pack --dry-run`：确认发布包内容完整

Linux 本机验证使用同一组只读/构建命令：`npm run check`、`npm test`、`npm pack --dry-run`。不需要为了验证去执行清理、禁用或会话删除命令。

验证入口：[GitHub Actions / macOS / Windows 验证](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml)。

## 目录结构

```
bin/skm.js              CLI 入口（参数解析与校验、命令分发）
src/adapters/           claude-code / codex 扫描适配器
src/commands/           doctor / risks / scan / list / search / recommend / graph / dupes / audit / sessions / toggle(disable+enable)
src/classify.js         分类规则引擎（DEFAULT_RULES + DEFAULT_OVERRIDES + 用户规则）
src/usage.js            会话日志使用统计（流式解析、增量缓存、墓碑聚合）
src/sessionsIndex.js    会话文件 → 工作区索引与清理策略
src/catalog.js          目录读写与同名合并
src/utils.js            共享工具（时区格式化、原子 JSON 读写、确认交互等）
integrations/           skill-navigator 薄入口 skill
scripts/                本地与 CI 共用的辅助脚本
test/                   node --test 单元测试
```

## Roadmap

- HTML 总览报告、更多 AIDE 适配器（Cursor、Gemini CLI 等）
- MCP 逐 server 的 tool schema token 实测

## 写在最后

skill 和 MCP 的生态越繁荣，"装得多、理不清"就越是每个 AIDE 重度用户的必经之痛。skm 不替你做删除的决定——它只负责把事实摆清楚：哪些重复、哪些从未被用过、哪些在拖慢启动。看清之后，清理就只是顺手的事。

如果这个工具帮你找回了对 skill 目录的掌控感，欢迎在 [GitHub](https://github.com/GrubbyLee/skill-manager) 点 Star ⭐（Gitee 同步镜像：<https://gitee.com/synovation/skill-manager>）；遇到问题或有新想法，欢迎提 [Issue](https://github.com/GrubbyLee/skill-manager/issues)。

## 许可证

[MIT](LICENSE)
