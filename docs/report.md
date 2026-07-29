# HTML 总览报告

`skm report` 把健康体检、风险、使用审计、会话日志和知识图谱摘要放到一页。

## 快速使用

```bash
skm report
skm report --format html --output skm-report.html
skm report --format html --output skm-report.html --anonymize
skm report --json
```

HTML 报告是零依赖单文件，可直接用浏览器打开。

## 报告内容

- 健康分、skill 总数、MCP 总数
- 从未使用、实体双份、会话日志体积、预计可释放空间
- 风险清单
- 使用频率 Top 10
- 常驻上下文开销 Top 10
- MCP schema 开销估算 Top 10
- 会话日志最大的工作区
- 知识图谱关系摘要
- 下一步推荐命令

## 匿名导出

对外分享报告前建议使用：

```bash
skm report --format html --output skm-report.html --anonymize
```

脱敏会处理路径、真实路径、配置文件位置、扫描目录、工作区和 MCP `command`。报告仍保留分类、数量、关系、风险级别和 token 估算，便于他人判断问题。

## MCP schema 估算

报告会展示每个 MCP server 的静态 schema 上下文开销估算。当前版本不会启动 MCP server，也不会读取 `env` 值；估算只基于扫描到的 server 名称、transport 与命令元数据，用于发现“可能长期占上下文”的项。

## 安全边界

`report` 是只读命令。它可能更新 `~/.skill-manager/usage-cache.json` 和会话索引缓存，但不会修改 Claude/Codex/Cursor/Gemini 的配置、skill、MCP 或会话日志。
