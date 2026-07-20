# 贡献指南

感谢你愿意改进 skill-manager。这个项目面向 Claude Code / Codex skill 与 MCP 重度用户，目标是把本机能力目录看清、理顺、管稳。

## 本地开发

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
npm install --ignore-scripts
npm run check
npm test
```

本项目零第三方依赖，`package.json` 不应出现 `dependencies`。

## 提交前检查

```bash
npm run check
npm test
npm pack --dry-run --registry=https://registry.npmmirror.com
```

Linux 可在本机执行以上命令；GitHub Actions 会自动验证 macOS 与 Windows。

## 适合贡献的方向

- 新的 skill 分类规则或误分类修正
- 新的 AIDE 适配器，例如 Cursor、Gemini CLI
- `recommend` 的中文任务意图识别优化
- `graph` 的关系识别、布局和导出样式优化
- `doctor` / `risks` 的诊断项补充
- 文档、截图、真实使用案例

## 代码约定

- Node.js >= 18，ES Modules
- 用户可见输出使用简体中文
- 日期展示使用项目内工具函数，保持 Asia/Shanghai
- 参数入口尽早校验，失败时给清晰错误
- 不读取或记录 API Key、密码、密钥文件
- MCP 扫描不读取 `env` 字段的值

## 写操作要求

涉及 `sessions --clean`、`disable`、`enable` 的改动要格外谨慎：

- 保留确认流程
- 保留备份机制
- 保留 24 小时安全窗口
- 保留 dry-run 行为
- 增加或更新测试

## Pull Request 建议

提交 PR 时请说明：

- 改了什么
- 为什么要改
- 如何验证
- 是否影响写操作边界

如果是功能建议，也可以先开 Issue 讨论场景和边界。
