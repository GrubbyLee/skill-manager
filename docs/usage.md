# skm 完整命令手册

本文是 README 的详细版，适合在安装后查命令、看参数、做排查。

## 安装

npm 全局安装：

```bash
npm i -g aide-skill-manager
skm scan
```

可选：安装桥接 skill，让 Claude Code / Codex 能在对话里调用本机 `skm`：

```bash
skm setup
skm setup --dry-run
```

国内如果 npm 官方源较慢，可临时使用镜像：

```bash
npm i -g aide-skill-manager --registry=https://registry.npmmirror.com
```

源码安装适合本地开发或镜像兜底。

GitHub 主仓：

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
```

Gitee 镜像：

```bash
git clone https://gitee.com/synovation/skill-manager.git
cd skill-manager
node scripts/install.mjs
```

源码安装脚本会在当前仓库执行 `npm link`，让本机可以直接使用 `skm` 命令；同时会把附属 `skill-navigator` 桥接 skill 安装到 `~/.claude/skills/` 和 `~/.codex/skills/`。

不想全局 link 时，可以直接运行：

```bash
node bin/skm.js scan
node bin/skm.js ask "把网页转成 markdown"
```

这种方式适合临时体验 CLI；如果希望 Claude Code / Codex 通过附属 skill 默认访问本机 `skm`，npm 安装后运行 `skm setup`，源码安装时运行 `node scripts/install.mjs`。

安装脚本支持 dry-run：

```bash
node scripts/install.mjs --dry-run
```

dry-run 会展示即将执行的 `npm link` 与 `skill-navigator` 安装目标，但不会写入全局命令或用户 skill 目录。

## 语言

CLI 支持显式指定输出语言：

```bash
skm help --lang en
skm scan --lang zh-CN
SKM_LANG=en skm doctor
skm recommend "convert a web page to markdown" --lang en
skm graph --format html --output skill-graph.html --lang en
```

当前已覆盖 `help`、参数错误、`doctor`、`scan`、`setup`、`status`、`risks`、`report`、`list`、`search`、`recommend`、`ask`、`outdated`、`sources`、`state`、`install`、`update`、`rollback`、`lock`、`policy`、`profile`、`eval`、`history`、`graph`、`dupes`、`audit`、`sessions`、`disable`、`enable` 与安装脚本；`--json` 的字段名保持稳定。

## 推荐排查流程

```bash
skm doctor
skm scan
skm
skm risks
skm outdated
skm state plan
skm lock
skm lock verify
skm policy check
skm eval --all
skm report --format html --output skm-report.html
skm dupes
skm audit
skm list --mcp
skm sessions
skm sessions --clean --days 30 --keep 3 --dry-run
```

建议先只读排查，确认报告无误后再考虑 `install`、`update`、`rollback`、`profile apply`、`state set`、`disable`、`enable` 或 `sessions --clean`；执行前先跑对应的 `--dry-run`。

## 命令一览

| 命令 | 用途 | 常用选项 |
|---|---|---|
| `skm` / `skm status` | 一屏治理总览 | `--json` |
| `skm doctor` | 环境诊断 | `--json` |
| `skm risks` | 风险报告 | `--json` |
| `skm report` | 一页式总览报告 | `--format html`、`--output`、`--anonymize`、`--json` |
| `skm web` | 本地只读 Web 工作台 | `--port` |
| `skm scan` | 扫描 skill / MCP 并展示治理总览 | `--verbose`、`--json`、`--export json`、`--output`、`--anonymize` |
| `skm outdated` | 检查 skill 上游新旧 | `--online`、`--refresh`、`--json` |
| `skm sources` | 管理名称级或实例级上游地址 | `missing`、`add`、`list`、`remove`、`check`、`wizard`、`--instance`、`--all` |
| `skm state` | skill 状态治理计划与 Claude 原生状态写入 | `plan`、`list`、`set`、`--mode`、`--scope`、`--dry-run`、`--yes` |
| `skm install` | 安装完整目录/仓库包或直链 `SKILL.md` | `<源>`、`--tool`、`--dry-run`、`--yes`、`--allow-risk` |
| `skm update` | 按实例从已登记来源事务式更新 | `<skill>`、`--tool`、`--scope`、`--instance`、`--all`、`--allow-risk`、`--dry-run`、`--yes` |
| `skm rollback` | 按实例从整包快照回滚 | `<skill>`、`--tool`、`--scope`、`--instance`、`--all`、`--dry-run`、`--yes` |
| `skm lock` | 生成生命周期锁定文件 | `--json` |
| `skm lock diff` | 对比当前 skill 与锁定文件 | `[文件]`、`--json` |
| `skm lock verify` | 校验当前 skill 是否匹配锁定文件 | `[文件]`、`--json` |
| `skm policy` | 生命周期策略 | `init`、`check`、`--json` |
| `skm profile` | Claude Code 场景状态 profile | `list`、`create`、`apply`、`--dry-run`、`--yes` |
| `skm eval` | skill 质量评测 | `[skill]`、`--all`、`--json` |
| `skm history` | 生命周期事件记录 | `[skill]`、`--json` |
| `skm setup` | 安装桥接 skill | `--dry-run` |
| `skm list` | 列出 skill | `--category`、`--tool claude\|codex\|cursor\|gemini\|workbuddy\|kimi`、`--scope`、`--raw`、`--json` |
| `skm list --mcp` | 列出 MCP | `--tool`、`--json` |
| `skm search <词>` | 搜索 skill | `--json` |
| `skm recommend <任务>` | 推荐 skill | `--top`、`--tool`、`--category`、`--why`、`--advisor`、`--json` |
| `skm ask <任务>` | 问答式推荐 | `--tool`、`--category`、`--json` |
| `skm graph` | 知识图谱 | `--format json\|html\|mermaid`、`--output` |
| `skm dupes` | 重复检测 | `--json` |
| `skm audit` | 使用审计 | `--history`、`--json` |
| `skm sessions` | 会话日志分布 | `--json` |
| `skm sessions --clean` | 清理会话日志 | `--days`、`--keep`、`--dry-run`、`--yes` |
| `skm disable <名>` | 软禁用 skill | 可一次传多个名称、`--dry-run` |
| `skm enable [名]` | 恢复 skill | 不带名称时列出已禁用项；带名称时支持 `--dry-run` |
| `skm disable --mcp <名>` | 禁用 MCP | 自动备份，需确认；支持 `--dry-run` |
| `skm enable --mcp <名>` | 恢复 MCP | 自动备份，需确认；支持 `--dry-run` |
| `skm help` | 查看帮助 | 同 `skm -h` |

## scan

扫描 Claude Code、Codex、Cursor、Gemini 的 skill 与 MCP，生成 `~/.skill-manager/catalog.json`，然后展示和裸命令 `skm` 相同的治理总览。Cursor 与 Gemini 采用保守适配：扫描常见 skill 目录和 MCP 配置文件，不读取敏感编辑器缓存，不启动外部工具。

```bash
skm scan
skm scan --verbose
skm scan --json
skm scan --export json --output skm-scan.json --anonymize
```

输出会包含：

- Claude Code、Codex、Cursor、Gemini 各侧 skill 数量
- 用户、项目、插件来源分布
- MCP 数量
- 已归档目录数量
- 去重后 skill 总数
- 两侧同名安装数量
- 常驻上下文开销估算
- 上游版本线索：`version`、`source`、`repository`、git remote / HEAD
- 静态安全审计摘要（高 / 中 / 低 / 信息）
- 分类分布

已归档目录指名称以 `_` 或 `.` 开头、扫描时未计入的目录。

`--anonymize` 会脱敏路径、真实路径、配置文件位置、扫描目录、工作区、MCP `command` 和上游 `source` / `repository` / `homepage` / git remote，适合把扫描结果发到 Issue、Discussions 或社区求助。JSON 字段名保持英文且稳定。

## status

裸命令 `skm` 等价于 `skm status`，用于查看治理总览。

```bash
skm
skm status --json
```

治理总览按基础子命令分域展示：清单 `scan/list`、风险 `risks`、使用 `audit`、状态 `state`、版本 `outdated/sources`、生命周期 `lock/policy/eval/history`、重复 `dupes`、图谱 `graph`、会话 `sessions`、推荐 `ask/recommend`。每一行都包含概括、当前问题和建议操作。健康分为 0-100 的启发式评分，会综合僵尸率、实体双份、闲置 MCP、会话日志体积；它用于清理前后自我对比，不代表绝对质量。

## doctor 与 risks

```bash
skm doctor
skm risks
skm doctor --json
skm risks --json
```

`doctor` 检查运行环境，例如 Node.js 版本、目录、catalog、advisor CLI、CI 配置。

`risks` 汇总分级风险，例如实体双份、双份且从未使用、闲置 MCP、高上下文开销、高 MCP schema 估算、会话日志体积、不可观测项。它不直接禁用或删除任何 AIDE 数据。

## report

```bash
skm report
skm report --format html --output skm-report.html
skm report --format html --output skm-report.html --anonymize
skm report --json
```

`report` 会生成一页式总览，包含健康分、风险、使用频率、上下文开销、MCP schema 开销估算、会话日志、知识图谱摘要和下一步命令。HTML 报告是零依赖单文件，可直接用浏览器打开。对外分享前建议使用 `--anonymize`。详细说明见 [report.md](report.md)。

## web

```bash
skm web
skm web --port 17362
```

`web` 会启动 `127.0.0.1` 本地只读工作台，页面包含总览、支持使用次数/上下文排序与上下双端分页的 skill 清单、可行动的 3D 知识图谱、推荐入口和命令中心。图谱会汇总前缀套件、功能重叠、可串联流程和 MCP 依赖，可按具体套件、平台或分类聚焦；选中节点后可聚焦一跳关系、查看带置信度的关系证据、复制建议命令，并定位回 Skill 清单。Skill 清单里的名称支持悬浮查看描述，来源地址也支持悬浮查看。只读命令可在卡片终端中直接运行，写操作仍只提供可复制的 dry-run 建议。它使用 Node.js 内置 `http` 与原生 HTML/CSS/JS，不引入第三方依赖；页面支持赛博朋克、宇宙星系、蓝天白云三种主题和 3D 立体加载动画。工作台在缺少事实或手动刷新时，可能读取 AIDE 的 skill/MCP 元数据，并刷新 skm 自身的 `~/.skill-manager/catalog.json` 或缓存文件；但不会修改 AIDE 数据，不会执行 skill/MCP，也不会读取 MCP `env` 值。

## outdated

```bash
skm outdated
skm outdated --online
skm outdated --online --refresh
skm outdated --json
```

`outdated` 用于检查 skill 是否具备上游版本线索，以及本地状态是 `latest`、`outdated`、`ahead` 还是 `diverged`。默认只读本机 catalog。`--online` 才访问上游：git checkout 比对 remote commit；由 skm 登记过 package hash 的仓库/目录来源会重新取得完整包，结合 SemVer 与整包 hash 判断，因而能发现“版本未变、资源文件已变”；旧的直链 `SKILL.md` 来源继续按版本与内容 hash 检查。结果缓存 24 小时。

本命令只检查，不自动更新。看到落后结果后，应先查看上游 diff / release notes，再决定是否替换本地 skill。

## sources

```bash
skm sources missing
skm sources wizard
skm sources add baoyu-image-gen --source https://github.com/org/repo/tree/main/baoyu-image-gen
skm sources add baoyu-image-gen --source <url> --instance <安装实例ID>
skm sources check baoyu-image-gen --tool codex --scope user
skm sources list
skm sources check baoyu-image-gen
skm sources remove baoyu-image-gen
```

`sources` 用于补充没有声明 `source` / `repository` 的已安装 skill。v2 文件同时保存兼容的名称级记录与安装实例记录；同名多实例需用 `--tool`、`--scope`、`--instance` 精确选择，或用 `--all` 明确处理全部。实例来源优先，且不会套用到未匹配的同名实例。它不会修改已安装文件。

最便捷的方式是 `sources wizard`：它会逐个展示无法判断版本的 skill，输入上游 skill 目录或 `SKILL.md` URL 后立即保存；回车或 `s` 跳过，`q` 退出。需要脚本化处理时，可用 `sources missing --json` 导出待补充清单。

## lifecycle：install / update / rollback / lock / policy / profile / eval / history

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
skm profile list
skm profile create writing
skm profile apply writing --dry-run
skm eval --all
skm eval baoyu-image-gen --json
skm history baoyu-image-gen
```

这些命令用于把 skill 管起来，而不是只扫出来：

- `install`：本地、`file://`、GitHub/Gitee 和 git/SSH 目录来源安装完整包；直链 `SKILL.md` 安装单文件。所有目标先暂存、校验和扫描，全部准备好再提交；目标已存在时拒绝覆盖。
- `update`：按实例读取来源，展示整包文件差异并静态扫描包内文本/代码；high 级发现默认由策略阻断，人工复核后才用 `--allow-risk`。确认后建立实例隔离的完整包备份并原子替换；无变化不备份。直链单文件更新保留现有附属资源。
- `rollback`：恢复最近一个与当前 package hash 不同的实例快照，恢复前备份当前包，支持再次 rollback；软链保持不变，插件管理的 skill 拒绝直接处理。
- `lock`：写入 v3 锁文件，按安装实例记录稳定 key、位置 hash、版本、来源、git HEAD、`SKILL.md` hash 和 package hash；旧锁文件需重新生成。
- `lock diff [文件]`：静默刷新 skm 自身 catalog 后，对比当前 skill 与锁定文件的新增、删除和变更，不修改 AIDE 数据。
- `lock verify [文件]`：同样静默刷新 skm 自身 catalog，发现漂移时返回非 0，适合 CI 或升级脚本。
- `policy init/check`：初始化或检查本机治理策略，覆盖 skill 总量、从未使用比例、重复安装、来源覆盖和安全发现。
- `profile create/apply`：创建 Claude Code skill 状态快照，并按场景写回 `skillOverrides`；应用前备份设置文件。Codex/Cursor/Gemini 的状态切换仍走各自工具的原生 UI。
- `eval`：给 skill 打分，扣分项包括缺少描述、缺少 frontmatter、缺少来源、重复安装、上下文开销偏高、从未使用、安全发现。
- `history`：查看 skm 记录的安装、更新、回滚、锁定、策略和 profile 事件。

建议流程：先 `skm scan`，再用 `skm sources wizard` 补来源，然后 `skm lock` 建立基线；后续用 `skm lock diff` 查看环境漂移，用 `skm lock verify` 做脚本化校验。使用 `skm install` 引入的新 skill 如果带有来源，后续 `skm update` 会自动复用这条来源，不需要手工改 catalog。更新前先跑 `skm update <skill> --dry-run`，确认计划和安全审计没有异常后再执行。完整说明见 [lifecycle.md](lifecycle.md)。

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

使用频率只来自可观测日志。Claude Code / Codex 的 skill 使用信号更完整；Cursor / Gemini 当前以扫描、分类、重复检测、静态安全审计和报告展示为主，不会为了补齐统计而推断真实使用次数。

同时，`audit` 会展示 `scan` 已记录的静态安全审计结果，包括：

- skill 中疑似读取或外发密钥、私钥、`.env`、凭据的描述
- 疑似破坏性命令、远程脚本直连执行、编码 PowerShell、高权限命令
- MCP 启动命令中疑似携带 token/API key/password
- MCP 明文 HTTP、shell 求值、动态包运行器、过高容器权限或免确认信任配置

安全审计读取 `SKILL.md`、skill 包内文本/代码文件和 MCP 非 `env` 配置字段；不会执行 skill/MCP，也不会输出 env 值。发现项会标注证据文件。`audit` 还会离线统计上游版本线索覆盖率。解析结果会写入 `~/.skill-manager/usage-cache.json` 做增量缓存；每次审计还会归档快照。

## state

```bash
skm state plan
skm state plan --json
skm state list
skm state set baoyu-image-gen --tool claude --mode name-only
skm state set old-skill --tool claude --mode off --scope user
skm state set old-skill --tool claude --mode user-invocable-only --dry-run
```

`state` 用于处理“skill 太多”的生命周期治理问题。它不会删除 skill。推荐顺序是：先用 `state plan` 看降载建议，再对 Claude Code 使用原生状态；AIDE 原生状态不可用时，才考虑 `skm disable <skill>` 这种目录级软禁用兜底。

`state plan` 会根据以下信号给出建议：

- 重复安装且从未使用：优先 `off`
- 从未使用且上下文开销高：优先 `user-invocable-only`
- 长期未用或偶尔用：优先 `name-only`
- 常用且无明显负担：保持 `on`

Claude Code 支持自动写入 `skillOverrides`。官方状态名是 `user-invocable-only`；写入前会备份设置文件，默认要求输入 `yes` 确认。Codex 当前建议继续使用内置 `/skills` -> Enable/Disable Skills 交互界面，skm 不猜测或改写未稳定公开的状态文件。

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
skm disable gsap-plugins --dry-run
skm enable gsap-plugins
skm enable
skm disable --mcp drawio
skm disable --mcp drawio --dry-run
skm enable --mcp drawio
```

skill 禁用只是目录重命名加 `_disabled-` 前缀，可逆且不删除文件。MCP 禁用会修改配置文件，修改前会自动备份并要求确认。`disable` / `enable` 都支持 `--dry-run` 预览计划；dry-run 不改目录、不写配置、不创建备份、不刷新扫描结果。

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
