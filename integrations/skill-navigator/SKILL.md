---
name: skill-navigator
version: 0.1.4
description: Use when users ask which local Agent Skill to use, what skills/MCP servers are installed, or how to scan, recommend, audit, deduplicate, clean up, or visualize skills. 当用户询问当前有哪些 skill、该用哪个 skill、skill/MCP 清单、分类、重复、审计、清理或知识图谱时使用。通过 skm CLI 读取本机真实目录并解读，不要自己去扫描文件系统。
category: developer-tools
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

本 skill 是 `skill-manager` 的 AIDE 桥接入口。用户安装本项目后，`skm setup` 或 `node scripts/install.mjs` 会把它安装到 Claude Code 与 Codex 的用户 skill 目录；它负责让编程助手通过本机 `skm` 命令读取真实目录、审计数据和推荐结果。

回答用户关于本机 skill / MCP 的问题时，一律通过 `skm` CLI 获取数据（它会扫描 Claude Code、Codex、Cursor、Gemini 并做分类去重），不要手动遍历 `~/.claude/skills` 等目录。

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

1. **"有哪些 skill？"** —— 运行 `skm list`，按分类向用户概述（每类挑代表性条目，不要全量罗列）。
2. **"做某件事该用哪个 skill？"** —— 优先运行 `skm recommend "<任务描述>" --json`，结合结果推荐最合适的 1~3 个并说明理由与差异（例如同为 PPT 类，不同 skill 的侧重点）；结果不理想再用 `skm search <关键词> --json` 或 `skm list --json` 全量匹配。
3. **"来自 GitHub/Gitee 的 skill 是不是最新？"** —— 先运行 `skm outdated` 看本地上游线索；只有用户明确要联网检查时再运行 `skm outdated --online`。说明该命令只检查不更新，落后项需先查看上游 diff / release notes。
4. **"哪些重复了 / 怎么清理？"** —— 运行 `skm dupes` 与 `skm audit`，交叉解读：软链共享的不用动；实体双份建议软链化；"从未使用 + 实体双份"的交集是最优先清理对象。给建议即可，清理动作让用户确认后自己执行（该工具只读）。
5. **"展示 skill 之间的关系 / 画知识图谱 / 导出图谱"** —— 运行 `skm graph` 看摘要；需要文件时用 `skm graph --format html --output skill-graph.html`，或 `--format json/mermaid`。向用户说明关系类型与置信度，不要把推断关系说成确定依赖。
6. **"哪些 skill 没用过 / 想瘦身"** —— 运行 `skm audit`，重点看僵尸 skill 清单与从未使用的 MCP；历史趋势看 `skm audit --history`。用户决定禁用时用 `skm disable <名>`（可逆），恢复用 `skm enable <名>`；禁用 MCP 用 `skm disable --mcp <名>`（会改配置文件，自动备份，需用户确认）。
7. **"会话日志太大 / 想清理会话"** —— 先 `skm sessions` 看分布，再 `skm sessions --clean --days N --keep N --dry-run` 给用户看清理计划；真正删除必须由用户确认（交互输入 yes 或明确要求加 --yes）。
8. **"MCP 有哪些 / 启动为什么慢？"** —— 运行 `skm list --mcp` 与 `skm audit`，说明 MCP tool schema 会全量注入上下文，是主要开销。
9. **数据看起来过期**（新装过 skill）—— 先 `skm scan` 再回答。

## 注意

- `skm` 输出为中文，JSON 字段为英文；向用户转述时用中文。
- 推荐 skill 时优先推荐"两侧"都可用的（`tools` 含两个工具）。
