# 安全边界与数据说明

`skm` 的设计原则是：先把事实摆清楚，再让用户决定是否治理。

## 默认只读

大多数命令不会修改 Claude/Codex 的配置、skill、MCP 或会话日志：

```bash
skm
skm doctor
skm risks
skm scan
skm list
skm search
skm recommend
skm ask
skm graph
skm dupes
skm audit
skm sessions
```

其中 `scan`、`audit`、`risks`、`sessions` 可能更新 `~/.skill-manager` 下的 skm 自身数据，例如 catalog、usage cache、audit history、sessions index。这些不是 AIDE 数据，不会改变 Claude Code 或 Codex 的行为。

## 三类写操作

| 动作 | 改动内容 | 防护 |
|---|---|---|
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

确认闲置或重复后再操作。

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
| `~/.skill-manager/audit-history/` | 审计快照 |
| `~/.skill-manager/backups/` | MCP 配置修改前备份 |
| `~/.skill-manager/rules.json` | 用户自定义分类规则 |

## 日期与时区

面向用户展示的日期统一使用 Asia/Shanghai。数据文件内部仍保存 ISO/UTC 时间，便于跨端处理。
