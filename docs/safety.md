# 安全边界与数据说明

`skm` 的设计原则是：先把事实摆清楚，再让用户决定是否治理。

## 默认只读

大多数命令不会修改 Claude Code、Codex、Cursor、Gemini、WorkBuddy、Kimi 的配置、skill、MCP 或会话日志：

```bash
skm
skm doctor
skm risks
skm scan
skm list
skm search
skm recommend
skm ask
skm outdated
skm state plan
skm state list
skm lock
skm policy check
skm profile list
skm eval
skm history
skm graph
skm dupes
skm audit
skm sessions
```

其中 `scan`、`audit`、`risks`、`sessions`、`outdated --online`、`lock`、`policy`、`profile create`、`history` 可能更新 `~/.skill-manager` 下的 skm 自身数据，例如 catalog、usage cache、audit history、sessions index、update cache、lock、policy、profiles、lifecycle history。这些不是 AIDE 数据，不会改变任何受支持 AIDE 的行为。普通 `scan` 不为版本检查联网；只有 `scan --online` / `outdated --online` 只读访问已登记上游，且不会自动更新 skill。

`sources discover` 只在用户确认后访问 GitHub 官方 API，只发送 skill 名称，不发送本地路径、skill 正文或其他清单。它读取公开候选 `SKILL.md` 做验证，用户选择前不写来源。`GITHUB_TOKEN` 仅作为请求头使用，不写缓存、不显示在输出中。

显式运行 `skm setup` 或 `node scripts/install.mjs` 是安装阶段的例外：它们会把附属 `skill-navigator` 桥接 skill 安装到 `~/.claude/skills/` 与 `~/.codex/skills/`。如果目标目录已有不同内容，会先备份旧目录再替换。

`skm state plan` 与 `skm state list` 只读；只有显式 `skm state set` 才会写入 Claude Code 设置。

`skm install`、`skm update`、`skm rollback` 和 `skm profile apply` 是显式生命周期写操作。它们默认要求确认，并提供 `--dry-run` 预览。

## CLI 写操作

| 动作 | 改动内容 | 防护 |
|---|---|---|
| `setup` | 安装 `skill-navigator` 桥接 skill | 显式命令；支持 `--dry-run`；目标已有不同内容时先备份再替换 |
| `install <源>` | 安装 skill 到用户 skill 目录 | 所有目标先暂存、校验并做整包静态审计；高危项由策略阻断；目标已存在时拒绝覆盖；默认需确认；支持 `--dry-run` |
| `update <skill>` | 替换所选安装实例的完整包 | 拒绝同名歧义与插件实例；展示文件级差异；高危门禁；实例级整包备份；目录重命名原子替换并在失败时恢复；支持 `--dry-run` |
| `rollback <skill>` | 用实例级完整包快照恢复 skill | 只读取该实例的备份；恢复前备份当前包；原子替换；默认需确认；支持 `--dry-run` |
| `profile apply <名称>` | 写入 Claude Code `skillOverrides` | 只写用户级 Claude Code 设置；修改前备份；默认需确认；支持 `--dry-run` |
| `state set <skill>` | 写入 Claude Code `skillOverrides` | 仅支持 Claude 原生状态；修改前备份设置文件；默认需确认；支持 `--dry-run` |
| `sessions --clean` | 删除会话日志文件 | 必须显式给保留策略；先打印完整计划；交互确认或 `--yes`；24 小时内活跃会话永不删；未知工作区只接受 `--days` 策略；删除前聚合统计 |
| `disable/enable <skill>` | 重命名 skill 目录 | 完全可逆，不删文件；插件 skill 拒绝处理 |
| `disable/enable --mcp` | 修改 `~/.claude.json` / `config.toml` | 每个 MCP 每次操作独立备份；Codex 侧行级注释可逐字节还原；恢复时不覆盖用户手动重建的同名配置；需确认 |

## MCP 安全

扫描 MCP 时不会读取 `env` 字段的值，只记录 server 名称、工具来源、transport、command 等治理所需信息。

`disable --mcp` 会修改配置文件，所以执行前会备份并要求确认。建议先运行：

```bash
skm list --mcp
skm audit
skm risks
```

使用频率审计只来自可观测会话日志。Claude Code / Codex 的使用信号更完整；Cursor / Gemini 当前不读取敏感编辑器缓存，也不会根据目录存在推断真实使用次数。

确认闲置或重复后再操作。

## skill 包安全

仓库/目录来源会复制完整包，但 skm 不执行其中的脚本。安装和更新会扫描 `SKILL.md` 以及包内可识别的文本/代码文件，发现项包含证据文件路径。策略默认阻断 high 级发现；`--allow-risk` 不是自动信任开关，只应在人工检查具体文件和差异后使用。

候选包先写到目标目录同级的隐藏暂存目录，并要求存在普通文件 `SKILL.md`。提交使用目录重命名；如果替换失败，会尝试恢复旧目录。直链 `SKILL.md` 更新从现有目录生成候选，因此不会误删已有脚本和资源。软链安装会更新真实目录并保留链接。

## 会话日志清理

推荐先 dry-run：

```bash
skm sessions --clean --days 30 --keep 3 --dry-run
```

确认计划后再去掉 `--dry-run`。删除前会先把待删日志里的使用统计聚合进缓存，因此不会破坏 `skm audit` 的累计数字。

## 数据文件

| 路径 | 用途 |
|---|---|
| `~/.skill-manager/catalog.json` | 扫描后的 skill / MCP 目录 |
| `~/.skill-manager/usage-cache.json` | 使用统计增量缓存 |
| `~/.skill-manager/update-cache.json` | 上游版本检查缓存 |
| `~/.skill-manager/sources.json` | v2 来源表，含名称级兼容记录与实例级来源/package hash |
| `~/.skill-manager/skill-lock.json` | v3 skill 生命周期锁文件，含安装身份与整包 hash |
| `~/.skill-manager/lifecycle-history.json` | skm 生命周期事件记录 |
| `~/.skill-manager/policy.json` | 生命周期策略 |
| `~/.skill-manager/profiles.json` | Claude Code 场景状态 profile |
| `~/.skill-manager/skill-backups/` | 按安装实例隔离的完整包快照（`payload/` + `metadata.json`） |
| `~/.skill-manager/audit-history/` | 审计快照 |
| `~/.skill-manager/backups/` | MCP 配置或 Claude 状态设置修改前备份 |
| `~/.skill-manager/rules.json` | 用户自定义分类规则 |

## 日期与时区

面向用户展示的日期统一使用 Asia/Shanghai。数据文件内部仍保存 ISO/UTC 时间，便于跨端处理。
