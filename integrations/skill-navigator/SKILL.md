---
name: skill-navigator
description: 当用户询问"当前有哪些 skill / 该用哪个 skill / skill 或 MCP 的清单、分类、重复、清理"时使用。通过 skm CLI 读取本机 skill 目录并解读，不要自己去扫描文件系统。
---

# skill-navigator：skill 清单导航

回答用户关于本机 skill / MCP 的问题时，一律通过 `skm` CLI 获取数据（它已扫描 Claude Code 与 Codex 两侧并做了分类去重），不要手动遍历 `~/.claude/skills` 等目录。

若 `skm` 命令不存在，用绝对路径：`node ~/codes/skill-manager/bin/skm.js`。

## 场景与命令

1. **"有哪些 skill？"** —— 运行 `skm list`，按分类向用户概述（每类挑代表性条目，不要全量罗列）。
2. **"做某件事该用哪个 skill？"** —— 优先运行 `skm recommend "<任务描述>" --json`，结合结果推荐最合适的 1~3 个并说明理由与差异（例如同为 PPT 类，不同 skill 的侧重点）；结果不理想再用 `skm search <关键词> --json` 或 `skm list --json` 全量匹配。
3. **"哪些重复了 / 怎么清理？"** —— 运行 `skm dupes` 与 `skm audit`，交叉解读：软链共享的不用动；实体双份建议软链化；"从未使用 + 实体双份"的交集是最优先清理对象。给建议即可，清理动作让用户确认后自己执行（该工具只读）。
4. **"哪些 skill 没用过 / 想瘦身"** —— 运行 `skm audit`，重点看僵尸 skill 清单与从未使用的 MCP；历史趋势看 `skm audit --history`。用户决定禁用时用 `skm disable <名>`（可逆），恢复用 `skm enable <名>`；禁用 MCP 用 `skm disable --mcp <名>`（会改配置文件，自动备份，需用户确认）。
5. **"会话日志太大 / 想清理会话"** —— 先 `skm sessions` 看分布，再 `skm sessions --clean --days N --keep N --dry-run` 给用户看清理计划；真正删除必须由用户确认（交互输入 yes 或明确要求加 --yes）。
6. **"MCP 有哪些 / 启动为什么慢？"** —— 运行 `skm list --mcp` 与 `skm audit`，说明 MCP tool schema 会全量注入上下文，是主要开销。
7. **数据看起来过期**（新装过 skill）—— 先 `skm scan` 再回答。

## 注意

- `skm` 输出为中文，JSON 字段为英文；向用户转述时用中文。
- 推荐 skill 时优先推荐"两侧"都可用的（`tools` 含两个工具）。
