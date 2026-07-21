# 社区传播素材

本文用于项目发布、社区介绍和用户邀请。内容可以按平台长度裁剪。

## 一句话

skill-manager 是 Claude Code / Codex skill 与 MCP 的管理工具：扫描、推荐、去重、审计、风险报告和知识图谱。

## 短介绍

如果你在 Claude Code 或 Codex 里装了很多 skill，很快会遇到几个问题：到底装了多少、哪些重复、哪些从未用过、做某件事该选哪个、MCP 是否在消耗上下文。

`skm` 会把这些问题变成一组可以直接运行的命令：

```bash
skm scan
skm
skm ask "我要把网页转成 Markdown"
skm graph --format html --output skill-graph.html
```

它默认只读，零第三方依赖，仅需 Node.js >= 18。当前支持 Claude Code 与 Codex CLI。

GitHub：<https://github.com/GrubbyLee/skill-manager>

## 长介绍

我在自己的机器上装了大量 Claude Code / Codex skill，后来发现 skill 生态越丰富，管理成本也越高：

- 同一个 skill 可能在两侧重复安装
- 有些目录只是软链共享，有些却是实体双份
- 一些 skill 名字相近，但用途并不一样
- MCP server 会常驻注入上下文，闲置时也有成本
- 会话日志越来越大，但不能随便删，因为会影响历史使用统计
- 真正要做任务时，经常想不起应该用哪个 skill

于是做了 `skill-manager`，命令名 `skm`。

它目前可以：

- 扫描 Claude Code / Codex 的 skill 与 MCP
- 按中文规则分类
- 检测同名、同内容、同类多实现和文本相似
- 审计真实使用频率，找出从未使用的 skill
- 根据自然语言任务推荐合适的 skill
- 导出可筛选、可拖动的单文件 HTML 知识图谱
- 生成环境诊断和风险报告
- 按工作区查看会话日志，并提供 dry-run 清理计划

安装：

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
skm scan
```

如果你也装了不少 skill，欢迎晒一下你的 `skm scan` 结果：

<https://github.com/GrubbyLee/skill-manager/discussions/2>

## 适合发帖的标题

- 我装了 165 个 skill 后，写了一个管理 Claude Code / Codex skill 的工具
- Claude Code / Codex skill 装多了以后，怎么知道该用哪个？
- 用知识图谱整理你的 Claude Code / Codex skill 和 MCP
- skill-manager：扫描、推荐、去重、审计你的 AIDE skill

## 发布清单

- README 首屏是否能 30 秒跑起来
- 是否有截图或图谱示例
- Release 是否存在
- Discussions 是否有晒图入口
- Issue 模板是否能引导用户提供 `skm doctor` / `skm scan`
- 是否明确说明默认只读和三类写操作边界
