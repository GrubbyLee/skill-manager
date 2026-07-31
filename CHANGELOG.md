# 更新日志

## 未发布

- HTML 知识图谱新增“节点上限”控件，大图可优先显示高信号节点，搜索时自动放开上限避免隐藏精确匹配。
- README 与详细文档补清 Cursor / Gemini 的保守扫描边界：当前不读取敏感编辑器缓存，也不推断真实使用次数。
- 新增 npm Trusted Publishing 工作流，main 分支提交后会在版本未发布时自动发布 npm 包。
- 新增中英文发布流程文档，记录 npmjs.com 端 Trusted Publisher 配置与日常发布步骤。

## v0.1.3

- 首次支持 npm 官方源发布，安装方式为 `npm i -g aide-skill-manager`。
- 新增 `skm setup`，npm 安装后可显式安装 `skill-navigator` 桥接 skill；支持 `--dry-run`，目标已有不同内容时先备份再替换。
- README、命令手册与安全文档改为 npm 安装优先，同时保留源码安装路径。
- npm 发布包补齐 README 引用的动态图资源，修正 `bin.skm` 发布元数据，避免 npm publish 自动修正。
- 新增匿名导出：`scan` / `report` 支持 `--anonymize`，会脱敏路径、工作区、配置位置、MCP 命令和 warning 中内嵌的本机路径。
- 新增 Cursor / Gemini skill 目录的保守扫描适配器。
- 新增 MCP schema 常驻上下文静态估算，并接入 `risks` 与 `report`。
- 知识图谱新增强/弱替代、上下游、共享格式、同平台动作和图谱摘要；英文 HTML/JSON 会本地化关系 label 与 reason。
- 推荐排序会在相关候选内学习个人常用分类/套件偏好，不让高频无关 skill 混入。
- 新增 40 条中英文匿名推荐基准，报告 Top 1、Top 3、MRR 和已知错误率，并接入自动回归门槛。
- 增强中英文任务意图、非相邻动作词和转换方向识别，减少反向格式工具及无关候选。
- 推荐规则使用完整英文词边界，并兼容中文名称与中文 description 的专用 skill。
- 修复 Windows 上安装脚本直接启动 `.cmd` 可能失败的问题，统一通过系统 `ComSpec` 执行 `npm.cmd` 与 `skm.cmd`。
- 安装失败时补充退出码、信号和进程启动错误，避免只显示未知错误。
- 安装后的 `skm help` 验证失败时返回非零状态，不再误报安装完成。
- 删除中英文 README 快速开始中重复的手动 `npm link`，并同步中英文 Roadmap 状态。
- `risks`、`list`、`search`、`recommend`、`ask` 接入英文 / 简体中文输出。
- `graph`、`audit`、`sessions` 接入英文 / 简体中文输出，HTML 图谱界面支持 `--lang en`。
- `disable`、`enable` 接入英文 / 简体中文输出，保留确认、备份、防覆盖等写操作防护。
- `dupes` 接入英文 / 简体中文输出，JSON 结构保持不变。
- 新增 `skm report`，支持 summary/json/单文件 HTML 总览报告。
- 优化 HTML 图谱大规模布局：初始碰撞避让、放大、缩小、适配视图。
- 新增英文详细文档：命令手册、推荐、图谱、报告、安全、路线图和社区素材。
- 推荐输出增加常见评分理由的英文展示，同时保持 JSON 结构与默认中文字段兼容。
- 补充 CLI 国际化回归测试。

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
