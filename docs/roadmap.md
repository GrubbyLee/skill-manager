# Roadmap

skill-manager 的目标是成为 AIDE skill 管理领域最好用、最可信的开源工具：先把本机 skill / MCP 看清楚，再帮助用户推荐、治理、归档和复盘。

## 当前阶段

`v0.1.x` 重点是把核心闭环打稳：

- 扫描 Claude Code / Codex 的 skill 与 MCP
- 分类、搜索、推荐、知识图谱
- 重复检测、使用审计、风险报告
- 会话日志统计与安全清理计划
- 零第三方依赖与 macOS / Windows CI 验证
- README、docs、Issue 模板、Discussions、Release

## 近期优先级

| 优先级 | 方向 | 价值 | 状态 |
|---|---|---|---|
| P0 | 真实用户样本收集 | 用真实 `skm scan` / `recommend` 结果校准分类、推荐和图谱 | 进行中 |
| P0 | 推荐准确率提升 | 让“我要做某件事该用哪个 skill”成为默认入口 | 进行中 |
| P1 | HTML 总览报告 | 一次导出本机 skill 健康报告，适合分享和留档 | 未开始 |
| P1 | 图谱布局优化 | 大量 skill 时更清楚地查看套件、平台、流程关系 | 进行中 |
| P1 | 安装体验 | 在 npm 发布前，让 git clone 安装更稳、更易懂 | 进行中 |
| P1 | 英文文档与 CLI 国际化 | GitHub 默认入口服务全球用户，同时保留中文文档 | 进行中 |
| P2 | 更多 AIDE 适配器 | 支持 Cursor、Gemini CLI 等更多工具 | 规划中 |
| P2 | MCP token 实测 | 逐 server 估算 tool schema 常驻开销 | 规划中 |

## 推荐功能路线

- 收集中文任务样本，补充同义词和任务意图规则
- 增强转换方向识别，避免推荐反向工具
- 支持从 `skm audit` 中学习个人偏好，但不让高频无关 skill 混入
- 优化 `--advisor codex|claude` 的候选压缩和失败回退提示
- 增加推荐结果回归测试样本

## 知识图谱路线

- 改进大规模节点布局，减少初始重叠
- 增加更多关系：上下游、共享输入输出格式、同平台不同动作、强替代/弱替代
- 增加图谱摘要：最密集套件、重复核心、平台生态、潜在工作流
- 增加 HTML 报告模式，把图谱、风险和推荐入口放在同一页

## 社区协作

最需要的反馈：

- 贴出你的 `skm scan` 分类分布
- 提供误分类或漏分类的 skill 名称与描述
- 反馈 `skm ask "<任务>"` 推荐是否符合直觉
- 分享知识图谱截图，说明哪些关系有价值、哪些关系太吵
- 提出新的 AIDE 目录结构和 MCP 配置样本

入口：

- Discussions：<https://github.com/GrubbyLee/skill-manager/discussions>
- 晒 scan 结果：<https://github.com/GrubbyLee/skill-manager/discussions/2>
- Issues：<https://github.com/GrubbyLee/skill-manager/issues>
