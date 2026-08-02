---
name: skill-navigator
version: 0.1.5
description: Use when users ask which already-installed local Agent Skill should handle a task. It calls local skm recommendations from the real installed skill catalog; it does not perform the task itself. 当用户询问“做某件事应该用哪款已安装 skill”时使用。它通过本机 skm 基于真实已安装 skill 清单做推荐，本身不执行具体任务。
category: meta
homepage: https://github.com/GrubbyLee/skill-manager
source: https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator
platforms:
  - claude-code
  - codex-cli
requires:
  - aide-skill-manager
  - skm
compatibility:
  - Claude Code
  - Codex CLI
---

# skill-navigator：skill 清单导航

本 skill 是 `skill-manager` 的 AIDE 桥接入口。它只解决一个问题：当用户描述要做的事时，告诉用户本机已安装的哪一款 skill 最适合处理。

回答“该用哪个 skill”时，一律通过 `skm recommend "<任务描述>" --json` 获取推荐结果，不要手动遍历 `~/.claude/skills` 等目录，也不要凭记忆猜测。

若 `skm` 命令不存在，不要猜测安装路径；提示用户运行 `npm i -g aide-skill-manager` 后再执行 `skm setup`，或在 `skill-manager` 项目目录重新运行 `node scripts/install.mjs`，并检查 `npm link` / PATH 是否生效。

## 安装与更新

推荐安装：

```bash
npm i -g aide-skill-manager
skm setup
skm scan
```

源码安装：

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
skm scan
```

升级 `aide-skill-manager` 后，重新运行 `skm setup` 刷新本 skill。

本 skill 的唯一真源是 GitHub 仓库：`https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator`。第三方 skill hub 只作为索引入口；若平台支持 GitHub 同步，应优先指向该目录，而不是维护平台侧的独立副本。

## 场景与命令

1. **"做某件事该用哪个 skill？"** —— 运行 `skm recommend "<任务描述>" --json`，推荐最合适的 1~3 个已安装 skill，并说明为什么适合。
2. **推荐结果不理想** —— 运行 `skm search <关键词> --json` 辅助检索，再结合名称、描述、分类和可用 AIDE 目标给出建议。
3. **数据看起来过期**（用户刚安装或删除过 skill）—— 先提示用户运行 `skm scan` 更新目录，再重新推荐。

## 注意

- `skm` 输出为中文，JSON 字段为英文；向用户转述时用中文。
- 推荐 skill 时优先推荐"两侧"都可用的（`tools` 含两个工具）。
- 本 skill 不代替被推荐的 skill 执行任务。推荐完成后，应提示用户切换或调用对应 skill。
