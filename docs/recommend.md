# skill 推荐功能

`skm recommend` 与 `skm ask` 用来回答：“我现在要做这件事，应该用哪个 skill？”

## 快速使用

```bash
skm ask "把网页转成 markdown"
skm recommend "做小红书图片卡片" --top 5
skm recommend "markdown to html" --why
skm recommend "生成知识图谱" --advisor codex --why
```

`ask` 给首选、理由和备选；`recommend` 给排序表，适合比较候选。

## 默认推荐逻辑

默认推荐完全本地运行，不调用外部模型，不上传目录信息。排序会综合：

- 文本相关性：名称、frontmatter `name`、分类、description
- 中文同义词：例如“小红书”扩展到 `xhs` / `image cards`
- 任务意图：识别漫画、知识图谱、诊断、演示文稿、会议纪要等任务
- 转换方向：识别 `markdown to html`、`html to markdown`、`网页转 markdown`
- 使用记录：历史用过、最近 30/90 天用过会加权
- 可用范围：Claude/Codex 两侧都可用会优先

## 常用参数

| 参数 | 作用 | 示例 |
|---|---|---|
| `--top <N>` | 指定推荐数量，最多 20 | `skm recommend "生成封面图" --top 5` |
| `--tool claude\|codex` | 只推荐某一侧可用的 skill | `skm recommend "图片卡片" --tool codex` |
| `--category <关键字>` | 限制分类范围 | `skm recommend "封面图" --category 图像` |
| `--why` | 显示分数、命中词、方向识别 | `skm recommend "markdown to html" --why` |
| `--advisor codex\|claude` | 调用本机 AIDE CLI 做增强判断 | `skm recommend "生成知识图谱" --advisor codex` |
| `--json` | 输出结构化结果 | `skm recommend "写邮件" --json` |

## 增强模式边界

增强模式只在显式传 `--advisor` 时触发。

它不会增加 npm 依赖，只使用 Node.js 内置 `child_process` 调用本机已有 CLI。发送给 advisor 的是精简候选清单：skill 名称、分类、工具来源、description、使用次数、本地分数与理由。

不会发送：

- skill 真实路径
- Claude/Codex 配置路径
- MCP `env` 值
- API Key、密码、密钥文件
- 会话日志正文

如果 `codex` / `claude` 不在 PATH、未登录、网络不可用或调用超时，会提示原因并回退到本地推荐。

## 推荐自测

```bash
skm recommend "markdown to html" --why
skm recommend "html to markdown" --why
skm recommend "做小红书图片卡片" --tool codex --category 图像 --top 2
skm recommend "给 README 做四格漫画分镜" --why
skm recommend "生成漂亮的知识图谱" --why
skm ask "把网页转成 markdown"
skm recommend "生成封面图" --category 图像 --json
```

复杂任务建议同时看：

```bash
skm search <关键词>
skm audit
skm recommend "<任务>" --why
```
