<p align="center">
  <img src="../../docs/logo.svg" alt="skill-manager" width="640">
</p>

# skill-navigator

简体中文 | [English](README.md)

`skill-navigator` 是 [skill-manager](https://github.com/GrubbyLee/skill-manager) 附属的桥接 skill。它让 Claude Code / Codex 可以调用本机 `skm`，回答“当前有哪些 skill / 该用哪个 skill / 哪些重复或闲置 / 能否生成知识图谱 / MCP 是否带来上下文开销”等问题。

它刻意保持很薄：不自己扫描目录，不凭记忆猜测，而是调用 `skm` 读取用户机器上的真实扫描目录、审计结果和推荐排序。

## 安装

```bash
npm i -g aide-skill-manager
skm setup
skm scan
```

`skm setup` 会把本桥接 skill 安装到：

```text
~/.claude/skills/skill-navigator
~/.codex/skills/skill-navigator
```

源码安装：

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
skm scan
```

## 适用场景

| 用户问题 | 应调用的命令 |
|---|---|
| 我装了哪些 skill？ | `skm list` |
| 做某件事该用哪个 skill？ | `skm recommend "<任务>" --json` |
| 哪些 skill 重复？ | `skm dupes` |
| 哪些 skill 闲置或有风险？ | `skm audit` / `skm risks` |
| 来自 GitHub/Gitee 的 skill 是否最新？ | `skm outdated`；明确需要联网检查时才用 `skm outdated --online` |
| 能否画 skill 知识图谱？ | `skm graph --format html --output skill-graph.html` |
| 为什么启动或上下文开销变重？ | `skm list --mcp` / `skm audit` |
| 新装 skill 后目录是不是过期？ | `skm scan` |

## 对话示例

```text
我想把网页转成 Markdown，应该用哪个 skill？
```

```text
我要做一份产品 PPT 演示文件，推荐哪个已安装 skill？
```

```text
哪些 skill 重复了，哪些从来没用过？
```

```text
我从 GitHub 安装的 skill 现在还是最新的吗？
```

```text
帮我生成本机 skill 的 HTML 知识图谱。
```

## 安全边界

大多数 `skm` 命令对 AIDE 数据只读。桥接 skill 默认应使用 `list`、`search`、`recommend`、`audit`、`risks`、`report`、`graph` 等只读命令。

写操作仍然保持显式：

| 操作 | 防护 |
|---|---|
| `skm setup` | 安装本桥接 skill；目标目录已有不同内容时先备份 |
| `skm sessions --clean` | 必须给保留策略，并要求确认 |
| `skm disable` / `skm enable` | 软禁用或恢复 skill/MCP；修改配置时自动备份 |

## 发布到 skill hub 与后续更新

唯一真源是这个 GitHub 目录：

<https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator>

提交到 skill hub 时，优先选择 GitHub 仓库或源码 URL，而不是上传一份脱离仓库的副本。这样后续只需要更新 GitHub，并发布新的 `aide-skill-manager` npm 版本。

如果某个平台只能粘贴内容或上传文件，就把它当作镜像发布位；每次发版后按发布台账手动更新。

## 元信息

- npm 包：`aide-skill-manager`
- CLI 命令：`skm`
- 主项目：<https://github.com/GrubbyLee/skill-manager>
- 许可证：MIT
- 兼容 AIDE：Claude Code、Codex CLI
- 扫描生态：Claude Code、Codex CLI、Cursor、Gemini、MCP
