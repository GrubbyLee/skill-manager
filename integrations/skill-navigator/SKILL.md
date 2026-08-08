---
name: skill-navigator
version: 0.1.6
description: Use when users ask which already-installed local Agent Skill should handle a task. It calls local skm recommendations from the real installed skill catalog; it does not perform the task itself. 当用户询问“做某件事应该用哪款已安装 skill”时使用。它通过本机 skm 基于真实已安装 skill 清单做推荐，本身不执行具体任务。
category: meta
homepage: https://github.com/GrubbyLee/skill-manager
source: https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator
platforms:
  - claude-code
  - codex-cli
  - cursor
  - gemini
requires:
  - aide-skill-manager
  - skm
compatibility:
  - Claude Code
  - Codex CLI
  - Cursor (manually install)
  - Gemini (manually install)
---

# skill-navigator：skill 清单导航

本 skill 是 `skill-manager` 的 AIDE 桥接入口。它只解决一个问题：当用户描述要做的事时，告诉用户本机已安装的哪一款 skill 最适合处理。

默认以 `skm ask "<任务描述>" --json` 为主入口，输出更口语化的首选、理由和备选；在需要更详细候选或关键词检索时，再回退到 `skm recommend` 和 `skm search`。

回答“该用哪个 skill”时，一律通过本机 `skm` 获取推荐结果，不要手动遍历 `~/.claude/skills`、`~/.codex/skills` 等目录，也不要凭记忆猜测。

若 `skm` 命令不存在，不要猜测安装路径；提示用户运行 `npm i -g aide-skill-manager` 后再执行 `skm setup`，或在 `skill-manager` 项目目录重新运行 `node scripts/install.mjs`，并检查 `npm link` / PATH 是否生效。

## 安装与更新

推荐安装：

```bash
npm i -g aide-skill-manager
skm setup
skm scan
```

`skm setup` 会自动把本 skill 安装到 Claude Code 和 Codex 对应的用户 skill 目录。

### Cursor / Gemini 手动安装

本 skill 本身是纯 Markdown 指令，不依赖平台专属能力，所以也可以在 Cursor / Gemini 的 skill 目录中手动放置一份。

复制目录：

```bash
# Cursor（示例，具体路径以本机 Cursor 配置为准）
cp -R integrations/skill-navigator ~/.cursor/skills/skill-navigator

# Gemini（示例，具体路径以本机 Gemini CLI / 配置为准）
cp -R integrations/skill-navigator ~/.gemini/skills/skill-navigator
```

复制后仍需要本机已安装 `skm` 命令，且至少运行过一次 `skm scan`。

源码安装：

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
skm scan
```

升级 `aide-skill-manager` 后，重新运行 `skm setup` 刷新 Claude Code / Codex 侧的本 skill；Cursor / Gemini 侧手动维护时，重新复制一次目录即可。

本 skill 的唯一真源是 GitHub 仓库：`https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator`。第三方 skill hub 只作为索引入口；若平台支持 GitHub 同步，应优先指向该目录，而不是维护平台侧的独立副本。

## 主流程

按以下顺序处理“该用哪个 skill”类问题：

1. **优先使用 `skm ask`**
   - 命令：`skm ask "<任务描述>" --json`
   - 用途：直接给出首选 skill、推荐理由和备选，适合普通用户提问。
   - 转述要求：保留首选名称、理由、备选；如果有 `why` 或原因字段，直接转成自然语言，不要自己编原因。

2. **需要更详细候选时使用 `skm recommend`**
   - 命令：`skm recommend "<任务描述>" --top 5 --json`
   - 用途：列出更多候选，便于横向比较。
   - 筛选：如果用户明确只想看某个工具侧的 skill，追加 `--tool <claude|codex|cursor|gemini>`。

3. **名称或关键词更明确时使用 `skm search`**
   - 命令：`skm search "<关键词>" --json`
   - 用途：用户已经有明确关键词，比如“markdown”“PPT”“公众号”，想快速看相关 skill。

4. **目录可能过期时先刷新再推荐**
   - 触发信号：用户刚安装/删除了 skill、第一次使用、catalog 明显缺项、推荐结果里没有某个已知 skill。
   - 处理方式：先告诉用户“目录可能不是最新”，并建议运行 `skm scan`；扫描完成后再重新执行推荐。
   - 不要在未告知用户的情况下直接替用户触发 `skm scan` 作为默认行为。

## 常用任务模板

**普通提问**
- 输入：“我想把网页转成 Markdown，应该用哪个 skill？”
- 命令：`skm ask "把网页转成 markdown" --json`

**指定工具侧**
- 输入：“只看 Codex 上有什么做 PPT 的 skill？”
- 命令：`skm recommend "生成产品 PPT 演示文件" --tool codex --top 5 --json`

**关键词检索**
- 输入：“有没有和小红书相关的 skill？”
- 命令：`skm search "小红书" --json`

**目录过期**
- 输入：“我刚装了新 skill，为什么推荐里没有？”
- 回复：先提示运行 `skm scan` 更新目录，再重新推荐。

## 按工具筛选

当用户明确提到“只看 Claude 的”“Codex 侧”“Cursor 上有吗”“Gemini 有吗”时，应把工具名传给 `--tool`：

- `--tool claude`
- `--tool codex`
- `--tool cursor`
- `--tool gemini`

如果用户没有指定工具，就不要加 `--tool`，让 skm 返回所有可用候选；但转述时可以顺手说明“这款 skill 在哪些工具上可用”。

## 输出规范

- 始终说清楚“这是你本机已安装的 skill 推荐”，不要说成全网搜索。
- 首选 1 个，再列 1~3 个备选，不要一次性甩一堆。
- 每条推荐至少说明：名称、为什么适合、可用工具侧。
- 如果某款 skill 只在一个工具上可用，要明确指出来。
- 不要代替用户执行任务；推荐完成后，提醒用户可以切换或调用对应 skill。
- `skm` 输出 JSON 字段为英文，向用户转述时用中文。

## 错误与降级

- `skm` 命令不存在：提示安装 `aide-skill-manager` 并运行 `skm setup` / `skm scan`。
- 返回为空：告诉用户“没有在本机已安装 skill 里找到高相关候选”，并建议用 `skm search` 试更广的关键词，或运行 `skm scan` 刷新目录。
- JSON 解析失败：不要猜测结果，告诉用户命令输出异常，建议先 `skm doctor` 检查环境。
- 版本过旧 / 缺少 `ask` 命令：回退到 `skm recommend` 和 `skm search`。
- Cursor / Gemini 侧未安装本 skill：提示用户手动把 `integrations/skill-navigator` 放到对应 skill 目录，并确认本机有 `skm`。

## 注意

- 本 skill 不代替被推荐的 skill 执行任务。推荐完成后，应提示用户切换或调用对应 skill。
- 默认使用只读命令 `ask`、`recommend`、`search`；写操作仍需用户显式触发。
- 不要读取 MCP `env` 字段、密钥文件、`.env*`，也不要把它们放进推荐结果。
