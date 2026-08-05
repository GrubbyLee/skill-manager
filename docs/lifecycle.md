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
| `skm install <源>` | 安装本地 skill 目录或远程 `SKILL.md` | 用户 skill 目录 |
| `skm update <skill>` | 从已登记来源更新 skill | 用户 skill 目录；备份到 `~/.skill-manager/skill-backups/` |
| `skm rollback <skill>` | 从 skm 备份回滚 skill | 用户 skill 目录；回滚前再备份 |
| `skm lock` | 生成当前 skill 锁定文件 | `~/.skill-manager/skill-lock.json` |
| `skm lock diff [文件]` | 对比当前 skill 与锁定文件 | 只读；比较前静默刷新 catalog |
| `skm lock verify [文件]` | 校验当前 skill 是否匹配锁定文件 | 只读；发现漂移时返回非 0 |
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

本地目录会完整复制。远程 GitHub/Gitee skill 目录或 `SKILL.md` URL 当前只安装 `SKILL.md` 单文件，不自动拉取仓库脚本或资源目录。目标目录已存在时会拒绝覆盖。

安装成功后，`skm` 会自动把可用来源记录到 `~/.skill-manager/sources.json`：

- 远程 URL 安装：记录安装 URL。
- 本地目录安装：读取 `SKILL.md` frontmatter 中的 `source` / `repository` / `homepage` / `version`。
- 本地目录没有来源：安装仍会完成，但会提示运行 `skm sources add <skill> --source <url>`。
- 来源字段格式不合法：会明确提示被忽略的字段，避免误以为已经建立升级源。

这样后续 `skm update <skill>` 可以直接找到升级源，不需要手工修改 catalog。安装成功后会自动刷新本机 catalog，所以通常可以安装后直接运行 `skm update <skill> --dry-run` 验证闭环。

## 更新与回滚

`update` 依赖可直接读取的 `source` / `repository` / `homepage`。如果 skill 是通过 `skm install` 安装且当时记录了来源，通常可以直接更新。如果缺少来源，先补：

```bash
skm sources add my-skill --source https://github.com/org/repo/tree/main/skills/my-skill
```

更新前会展示计划和静态安全审计。真正写入前会备份旧目录。`rollback` 会恢复最近一次备份，并在恢复前备份当前目录。

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

锁定文件记录名称、工具、版本、来源、git HEAD 和 `SKILL.md` hash。`diff` 和 `verify` 会先静默刷新 catalog，再和锁定文件比较新增、删除、变更项；`verify` 发现漂移时返回非 0，适合放进 CI 或个人升级脚本。策略检查覆盖 skill 总量、从未使用比例、重复安装、来源覆盖和安全发现。策略文件是本机数据，可按团队习惯手工编辑。

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

默认先 `--dry-run`。远程安装和更新只读取 `SKILL.md`，不执行脚本，不读取密钥，不读取 MCP `env` 值。任何会修改 AIDE 文件的生命周期动作都需要显式命令和确认。
