# skill 全生命周期治理

`skm` 的生命周期命令覆盖八件事：引入、来源登记、更新、回滚、锁定、策略、场景 profile、质量评测。

## 推荐流程

```bash
skm scan
skm sources missing
skm sources wizard
skm lock
skm lock verify
skm policy check
skm eval --all
```

发现某个 skill 需要更新时：

```bash
skm update <skill> --dry-run
skm update <skill>
skm history <skill>
```

如果更新后不合适：

```bash
skm rollback <skill> --dry-run
skm rollback <skill>
```

## 命令说明

| 命令 | 作用 | 写入位置 |
|---|---|---|
| `skm install <源>` | 安装本地/仓库完整 skill 包或直链 `SKILL.md` | 用户 skill 目录 |
| `skm update <skill>` | 按安装实例从已登记来源事务式更新完整包 | 用户 skill 目录；实例级备份到 `~/.skill-manager/skill-backups/` |
| `skm rollback <skill>` | 按安装实例恢复完整包快照 | 用户 skill 目录；回滚前再备份 |
| `skm lock` | 生成当前 skill 锁定文件 | 刷新 skm 自身 catalog；写入 `~/.skill-manager/skill-lock.json` |
| `skm lock diff [文件]` | 对比当前 skill 与锁定文件 | 不改 AIDE 数据；比较前会刷新 skm 自身 catalog |
| `skm lock verify [文件]` | 校验当前 skill 是否匹配锁定文件 | 不改 AIDE 数据；发现漂移时返回非 0 |
| `skm policy init/check` | 初始化或检查治理策略 | `~/.skill-manager/policy.json` |
| `skm profile create/apply` | 保存或应用 Claude Code skill 状态 profile | `~/.skill-manager/profiles.json`；应用时写 Claude 设置 |
| `skm eval [skill]` | 评测 skill 质量 | 只读 |
| `skm history [skill]` | 查看生命周期事件 | `~/.skill-manager/lifecycle-history.json` |

## 安装

```bash
skm install ./my-skill --tool claude --dry-run
skm install ./my-skill --tool codex
skm install https://github.com/org/repo/tree/main/skills/my-skill --tool claude --dry-run
```

本地目录、`file://` 目录、GitHub/Gitee skill 目录和 git/SSH 仓库来源都会安装完整 skill 包，包括 `scripts/`、`references/`、assets 等附属文件；仓库采用浅克隆并只复制选定 skill 子目录。直链 `SKILL.md` 仍作为单文件来源支持。所有安装目标先写入隐藏暂存目录，校验 `SKILL.md` 并拒绝指向包外的内部软链，全部准备成功后才逐个原子提交。目标目录已存在时拒绝覆盖。

安装成功后，`skm` 会自动把可用来源记录到 v2 格式的 `~/.skill-manager/sources.json`：

- 远程 URL 安装：记录安装 URL、仓库 ref/subdir、解析到的 commit 和整包 hash（可用时）。
- 本地目录安装：读取 `SKILL.md` frontmatter 中的 `source` / `repository` / `homepage` / `version`。
- 本地目录没有来源：安装仍会完成，但会提示手动运行 `skm sources add <skill> --source <url>`，或在授权后运行 `skm sources discover <skill>` 搜索公开来源。
- 来源字段格式不合法：会明确提示被忽略的字段，避免误以为已经建立升级源。

这样后续 `skm update <skill>` 可以直接找到升级源，不需要手工修改 catalog。安装成功后会自动刷新本机 catalog，所以通常可以安装后直接运行 `skm update <skill> --dry-run` 验证闭环。

## 实例选择、更新与回滚

`update` 依赖可直接读取的 `source` / `repository` / `homepage`。如果 skill 是通过 `skm install` 安装且当时记录了来源，通常可以直接更新。如果缺少来源，先补：

```bash
skm sources add my-skill --source https://github.com/org/repo/tree/main/skills/my-skill
skm sources discover my-skill
```

`sources discover` 通过 GitHub 官方 API 搜索名称，只发送 skill 名称并读取公开候选的 `SKILL.md` 做验证。候选不会自动绑定；用户选择后才写入来源表，并记录搜索 provider、query、置信度、验证时间和确认状态。非交互模式使用 `--yes --json` 查看候选，使用 `--yes --select <编号>` 保存。GitHub 要求代码搜索鉴权时可设置 `GITHUB_TOKEN`。

来源登记后，普通 `skm scan` 仅使用 24 小时内的本地检查缓存；`skm scan --online` 才联网刷新版本状态，并在过期或分叉时给出实例级 dry-run 更新命令。

同名 skill 可能同时存在于不同工具、scope 或目录中。模糊写操作会拒绝执行，必须明确选择：

```bash
skm update my-skill --tool codex --scope user --dry-run
skm update my-skill --instance <安装实例ID>
skm update my-skill --all
skm rollback my-skill --instance <安装实例ID>
skm sources add my-skill --source <url> --instance <安装实例ID>
```

来源记录和备份都按稳定安装实例 ID 隔离；`--all` 会让每个实例使用自己的来源。旧版按名称的来源记录仍可读取，但只要某个同名 skill 已有实例记录，就不会把名称级来源泄漏给其他实例。

更新会先取得完整候选包，展示文件级 `added` / `changed` / `removed` 差异，并扫描 `SKILL.md` 及包内文本/代码文件。策略默认阻断 high 级发现；人工复核后可显式使用 `--allow-risk`。确认后先建立包含 `payload/` 与 `metadata.json` 的实例级整包快照，再以目录重命名原子替换。失败时自动恢复旧目录；整包无变化时不创建备份或历史事件。直链 `SKILL.md` 更新会保留已安装的脚本和资源。

`rollback` 恢复最近一个与当前整包 hash 不同的快照，并在恢复前备份当前目录，因此再次 rollback 可以恢复回滚前状态。软链实例更新真实目录并保留软链；插件管理的 skill 拒绝直接更新或回滚，应交给插件管理器处理。

## 锁定与策略

```bash
skm lock
skm lock --json
skm lock diff
skm lock diff ~/.skill-manager/skill-lock.json --json
skm lock verify
skm policy init
skm policy check
```

锁定文件 v3 按“实际安装实例”记录稳定 key、位置 hash、名称、工具、scope、版本、来源、git HEAD、`SKILL.md` hash 和完整 package hash。资源文件的增删改也会形成漂移。同名 skill 分别安装在多个工具或位置时会分别锁定和校验。`lock`、`diff` 和 `verify` 会先静默刷新 catalog；旧版锁文件、缺少 package hash 或重复 key 会直接报错并要求重新生成。`verify` 发现漂移时返回非 0，适合 CI。策略检查覆盖 skill 总量、从未使用比例、重复安装、来源覆盖和安全发现。

## Profile

```bash
skm profile create writing
skm profile list
skm profile apply writing --dry-run
```

`profile create` 会记录当前扫描到的 skill，并尽量带上当前 Claude Code `skillOverrides` 状态。`profile apply` 只写 Claude Code 用户级 `settings.json`，写入前备份。Codex、Cursor、Gemini 的状态切换仍建议使用各自工具的原生界面。

## 质量评测

```bash
skm eval --all
skm eval baoyu-image-gen --json
```

评测会从以下信号扣分：缺少 description、缺少 frontmatter、缺少来源、实体双份安装、上下文开销偏高、从未真实使用、静态安全发现。分数用于定位治理优先级，不代表 skill 的业务价值。

## 安全原则

默认先 `--dry-run`。远程仓库会被下载用于完整包复制和静态扫描，但 skm 不执行其中的脚本，不读取密钥，也不读取 MCP `env` 值。候选包通过暂存、校验、策略门禁、实例级备份和原子替换后才落盘。任何会修改 AIDE 文件的生命周期动作都需要显式命令和确认。
