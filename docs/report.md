# HTML 总览报告

`skm report` 把健康体检、风险、使用审计、会话日志和知识图谱摘要放到一页。

## 快速使用

```bash
skm report
skm report --format html --output skm-report.html
skm report --json
```

HTML 报告是零依赖单文件，可直接用浏览器打开。

## 报告内容

- 健康分、skill 总数、MCP 总数
- 从未使用、实体双份、会话日志体积、预计可释放空间
- 风险清单
- 使用频率 Top 10
- 常驻上下文开销 Top 10
- 会话日志最大的工作区
- 知识图谱关系摘要
- 下一步推荐命令

## 安全边界

`report` 是只读命令。它可能更新 `~/.skill-manager/usage-cache.json` 和会话索引缓存，但不会修改 Claude/Codex 的配置、skill、MCP 或会话日志。
