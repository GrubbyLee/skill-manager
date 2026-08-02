<p align="center">
  <img src="../../docs/logo.svg" alt="skill-manager" width="640">
</p>

# skill-navigator

简体中文 | [English](README.md)

`skill-navigator` 是 [skill-manager](https://github.com/GrubbyLee/skill-manager) 附属的桥接 skill。它只回答一个问题：**用户要做某件事时，本机已安装的哪一款 Agent Skill 最适合处理？**

它刻意保持很薄：不自己执行具体任务，不手动扫描目录，不凭记忆猜测，而是调用 `skm recommend` 基于用户机器上的真实已安装 skill 清单给出推荐。

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
| 做某件事该用哪个 skill？ | `skm recommend "<任务>" --json` |
| 推荐结果看起来不完整 | `skm search "<关键词>" --json` |
| 新装或删除 skill 后目录可能过期 | 先提示用户运行 `skm scan`，再重新执行 `skm recommend` |

## 对话示例

```text
我想把网页转成 Markdown，应该用哪个 skill？
```

```text
我要做一份产品 PPT 演示文件，推荐哪个已安装 skill？
```

```text
我想把 Markdown 文章发布到微信公众号，应该用哪个已安装 skill？
```

## 安全边界

桥接 skill 默认应使用 `recommend`、`search` 等只读推荐命令。

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
- 核心用途：推荐用户当前任务应该使用哪款已安装 skill
