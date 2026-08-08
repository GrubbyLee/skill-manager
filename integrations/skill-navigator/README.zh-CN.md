<p align="center">
  <img src="../../docs/logo.svg" alt="skill-manager" width="640">
</p>

# skill-navigator

简体中文 | [English](README.md)

`skill-navigator` 是 [skill-manager](https://github.com/GrubbyLee/skill-manager) 附属的桥接 skill。它只回答一个问题：**用户要做某件事时，本机已安装的哪一款 Agent Skill 最适合处理？**

它刻意保持很薄：不自己执行具体任务，不手动扫描目录，不凭记忆猜测，而是调用 `skm ask` / `skm recommend` 基于用户机器上的真实已安装 skill 清单给出推荐。

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

## Cursor / Gemini 手动安装

本 skill 是纯 Markdown 指令 skill，不依赖平台专属能力，也可以手动放到 Cursor 或 Gemini 的 skill 目录中使用。

示例：

```bash
# Cursor
cp -R integrations/skill-navigator ~/.cursor/skills/skill-navigator

# Gemini CLI（具体路径以本机配置为准）
cp -R integrations/skill-navigator ~/.gemini/skills/skill-navigator
```

手动安装后，仍需要本机存在 `skm` 命令，且至少运行过一次 `skm scan`。

## 适用场景

| 用户问题 | 应调用的命令 |
|---|---|
| 做某件事该用哪个 skill？ | `skm ask "<任务>" --json`（主入口） |
| 想要更多候选或横向对比 | `skm recommend "<任务>" --top 5 --json` |
| 已经有明确关键词 | `skm search "<关键词>" --json` |
| 只看某个工具侧的 skill | 追加 `--tool claude|codex|cursor|gemini` |
| 新装或删除 skill 后目录可能过期 | 先提示用户运行 `skm scan`，再重新推荐 |

## 推荐输出原则

- 首选 1 个，再列 1~3 个备选，不堆砌。
- 每条说清楚名称、理由、可用工具侧。
- 明确这是“本机已安装 skill”的推荐，不是全网搜索。
- 不代替用户执行任务；推荐完成后，提醒用户切换或调用对应 skill。

## 对话示例

```text
我想把网页转成 Markdown，应该用哪个 skill？
```

```text
我要做一份产品 PPT 演示文件，推荐哪个已安装 skill？
```

```text
只看 Codex 侧有哪些适合做小红书图片的 skill？
```

```text
我刚装了新 skill，为什么推荐里没有？
```

## 安全边界

桥接 skill 默认应使用 `ask`、`recommend`、`search` 等只读推荐命令。

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
- 兼容 AIDE：Claude Code、Codex CLI、Cursor（手动）、Gemini（手动）
- 核心用途：推荐用户当前任务应该使用哪款已安装 skill
