# skill-manager（skm）

> 当你的 Claude Code / Codex 里装了上百个 skill 和一堆 MCP——功能重复的、从来没用过的、连名字都想不起来的——启动越来越慢，想用时却分不清该用哪个。skm 就是为这个时刻准备的。

skm 是一个清点、梳理并治理 AIDE（Claude Code / Codex CLI）中 skill 与 MCP 的命令行工具：一眼看清当前装了哪些 skill、按能力自动分类、检测四种层次的重复、统计**真实使用频率**、识别僵尸 skill，并能安全地清理会话日志、软禁用不需要的 skill / MCP。默认只读，零第三方依赖（仅需 Node.js ≥ 18 运行环境）。

![skm 演示](docs/demo.png)

## 特性

- **双工具覆盖**：同时扫描 Claude Code（用户级 / 项目级 / 插件自带 skill、`~/.claude.json` 与 `.mcp.json` 的 MCP）和 Codex（`~/.codex/skills`、`config.toml` 的 MCP）
- **软链感知**：正确处理指向共享库（如 `~/.agents/skills`）的符号链接，区分"软链共享一份实体"与"实体双份拷贝"
- **规则分类**：内置中文分类规则（可通过 `~/.skill-manager/rules.json` 扩展/覆盖），未分类率趋近 0
- **四级重复检测**：同名多处安装 → 异名同内容 → 同类多实现 → 文本高度相似
- **使用审计**：解析两侧会话日志统计每个 skill / MCP 的真实使用频率，识别从未使用的僵尸项，快照自动归档
- **会话治理**：按工作区查看会话日志分布，按保留策略安全清理（确认式，统计先聚合再删除）
- **默认只读**：仅 `sessions --clean` / `disable` / `enable` 三个动作改动文件，均有确认与备份防护（见下文"写操作边界"）
- **零第三方依赖**：不依赖任何 npm 包，全部功能基于 Node.js 内置模块实现；唯一的运行环境要求是 Node.js ≥ 18

## 安装

```bash
# 方式一：npm 全局安装
npm i -g aide-skill-manager --registry=https://registry.npmmirror.com

# 方式二：源码安装
git clone https://gitee.com/synovation/skill-manager.git
cd skill-manager
npm link        # 之后可全局使用 skm 命令；不想 link 就用 node bin/skm.js
```

## 使用方法与结果示例

以下示例均为真实运行输出（表格截取前几行，工作区路径已泛化）。所有命令都支持 `--json` 输出供脚本或 AI 消费；输出在终端中带颜色高亮（管道/重定向时自动关闭，遵守 `NO_COLOR` 约定）。

### skm —— 一屏健康体检（裸命令即仪表盘）

不带任何参数直接运行 `skm`，得到当前 AIDE 的整体健康状况与可直接复制执行的建议：

```
$ skm
📊 skill 健康体检（目录扫描于今天，过期可 skm scan）
  能力总量   165 个 skill / 6 个 MCP
  僵尸 skill  105 个从未使用（64%）
  重复安装   40 组实体双份
  闲置 MCP   drawio
  会话日志   1.8GB（按 30 天 ∪ 留 3 个策略可释放 219.2MB）
  健康分     35 / 100

建议
  1. 双份且从未使用 20 个，最优先清理：skm disable baoyu-compress-image …
  2. 禁用闲置 MCP：skm disable --mcp drawio
  3. 会话瘦身（先看计划）：skm sessions --clean --days 30 --keep 3 --dry-run
  4. 完整报告：skm audit | skm dupes
```

健康分为启发式（僵尸率最高扣 40、实体双份每组扣 1、闲置 MCP 每个扣 5、会话日志每 GB 扣 10），用于自我对比与清理前后的量化反馈。

### skm scan —— 扫描并建立目录

扫描两侧全部 skill 与 MCP，生成 `~/.skill-manager/catalog.json`。选项：`--verbose` 显示全部解析警告。

```
$ skm scan
扫描完成 ✓
  Claude Code：skill 87（用户 72 / 插件 15），MCP 6
  Codex：      skill 118（用户 118），MCP 3
  去重后共 165 个 skill，其中 40 个在两侧同名安装
  常驻上下文开销估算（name+description）：约 15712 token/侧
  分类分布：办公协作（飞书） 25 | 内容抓取与转换 15 | 第三方服务集成 15 | 图像与视觉 14 | …
  已归档目录（_ 或 . 开头，未计入）：claude 0，codex 2
目录已写入 ~/.skill-manager/catalog.json
```

### skm list —— 分类清单

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

### skm search —— 关键词搜索

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

### skm dupes —— 四级重复检测

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

### skm audit —— 使用频率与僵尸审计

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

三、MCP 使用情况（Claude 侧 tool 调用计数）
名称              次数    最近使用
────────────────  ──────  ──────────
codex             10      12 天前
web-search-prime  10      12 天前
drawio            0       —
  ⚠ 从未使用的 MCP：drawio —— MCP schema 全量注入上下文，建议优先禁用

四、常驻上下文开销 Top 10（name+description 估算）
  …

建议
  1. 双份且从未使用 20 个，最优先清理：skm disable baoyu-compress-image …
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

### skm sessions —— 会话日志分布与清理

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

### skm disable / enable —— 软禁用 skill 与 MCP

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

工具默认只读；仅以下三个动作会改动文件，且各有防护：

| 动作 | 改动内容 | 防护 |
|---|---|---|
| `sessions --clean` | 删除会话日志文件 | 必须显式给保留策略；先打印完整清理计划；交互确认或 `--yes`；24 小时内活跃的会话永不删；未知工作区只接受 `--days` 策略；删除前自动把待删日志的使用统计聚合进缓存（墓碑机制） |
| `disable/enable <skill>` | 仅重命名 skill 目录 | 完全可逆，不删任何文件；插件 skill 拒绝处理 |
| `disable/enable --mcp` | `~/.claude.json` / `config.toml` | 每个 MCP 每次操作独立备份（文件名含名称+时间戳，绝不互相覆盖）；Codex 侧只做行级注释可逐字节还原；enable 遇到用户已手动重建的同名配置时跳过不覆盖；需确认 |

## audit 的数据来源

- Claude Code：解析 `~/.claude/projects/**/*.jsonl` 中的 Skill 工具调用与斜杠命令记录，MCP 按 `mcp__<server>__` 工具调用计数
- Codex：解析 `~/.codex/sessions/**/*.jsonl`，**只统计 function_call 中实际读取 `SKILL.md` 的行为**（Codex 会把全部可用 skill 路径注入会话上下文，直接匹配路径会严重虚高，已规避），同一会话同一 skill 只计 1 次
- 流式逐行读取（恒定内存，GB 级单文件也不受 Node 字符串上限影响）；按文件大小+mtime 增量缓存（`~/.skill-manager/usage-cache.json`，v2），首轮约十秒，之后毫秒级
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

## 目录结构

```
bin/skm.js              CLI 入口（参数解析与校验、命令分发）
src/adapters/           claude-code / codex 扫描适配器
src/commands/           scan / list / search / dupes / audit / sessions / toggle(disable+enable)
src/classify.js         分类规则引擎（DEFAULT_RULES + DEFAULT_OVERRIDES + 用户规则）
src/usage.js            会话日志使用统计（流式解析、增量缓存、墓碑聚合）
src/sessionsIndex.js    会话文件 → 工作区索引与清理策略
src/catalog.js          目录读写与同名合并
src/utils.js            共享工具（时区格式化、原子 JSON 读写、确认交互等）
integrations/           skill-navigator 薄入口 skill
test/                   node --test 单元测试
```

## Roadmap

- HTML 总览报告、更多 AIDE 适配器（Cursor、Gemini CLI 等）
- MCP 逐 server 的 tool schema token 实测

## 写在最后

skill 和 MCP 的生态越繁荣，"装得多、理不清"就越是每个 AIDE 重度用户的必经之痛。skm 不替你做删除的决定——它只负责把事实摆清楚：哪些重复、哪些从未被用过、哪些在拖慢启动。看清之后，清理就只是顺手的事。

如果这个工具帮你找回了对 skill 目录的掌控感，欢迎 Star ⭐；遇到问题或有新想法，欢迎提 [Issue](https://gitee.com/synovation/skill-manager/issues)。

## 许可证

[MIT](LICENSE)
