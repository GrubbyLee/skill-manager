# 更新日志

## v0.1.2

- README 改为英文默认入口，中文 README 移至 `README.zh-CN.md` 并在顶部支持中英文切换。
- 新增轻量 i18n 基础设施，支持 `--lang en|zh-CN` 与 `SKM_LANG`。
- `help`、参数错误、`doctor`、`scan`、`status`、安装脚本支持英文 / 简体中文输出。
- 保持 `doctor --json` 结构化输出不随语言参数改变，便于脚本稳定消费。
- 修正安装脚本非法 `--lang` 参数的报错值，并确保 `--help --lang <非法值>` 也会 fail fast。
- 新增 `scripts/install.mjs`，提供显式的 git clone 本地安装入口。
- 新增 Roadmap 与社区传播素材文档。
- README 与命令手册同步使用本地安装脚本。

## v0.1.1

- 优化 README：首页聚焦 30 秒体验、核心场景、推荐功能和知识图谱。
- 拆分详细文档：命令手册、推荐功能、知识图谱、安全边界。
- 新增贡献指南、Issue 模板、PR 模板，方便反馈问题、提交建议和分享 `skm scan` 结果。
- 发布包白名单补充 docs 与贡献文档。

## v0.1.0

- 初始公开版本。
- 支持扫描 Claude Code / Codex 的 skill 与 MCP。
- 支持分类清单、搜索、推荐、重复检测、使用审计、会话治理、知识图谱、环境诊断和风险报告。
