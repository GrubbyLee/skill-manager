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
- 使用记录：历史用过、最近 30/90 天用过会加权；相关候选内会学习常用分类和套件偏好
- 可用范围：在多个客户端可用的 skill 会获得轻微优先级；推荐结果会列出实际客户端

个人偏好只在候选已经与任务相关时生效。比如你经常使用 `baoyu-*` 图片套件，图片相关任务可能会给同套件候选小幅加分；但“会议纪要”任务不会因为图片套件历史高频而推荐图片 skill。

## 可度量的回归基准

仓库提供一套公开、匿名化的中英文推荐基准，用来判断排序规则修改是否造成退步：

```bash
npm run benchmark:recommend
```

当前基准包含 23 个合成 skill 和 40 条任务描述（中文、英文各 20 条），覆盖格式转换、图片、图谱、演示文稿、会议、翻译、代码审查、内容发布等常见场景。命令会报告：

| 指标 | 含义 |
|---|---|
| Top 1 | 第一名属于期望候选的案例比例 |
| Top 3 | 前三名至少包含一个期望候选的案例比例 |
| MRR | 首个正确候选排名的倒数均值，越接近 1 越好 |
| 已知错误率 | 前三名出现明确错误候选的案例比例，越低越好 |

当前固定数据集结果为 Top 1 100%、Top 3 100%、MRR 1.000、已知错误率 0%。这只说明当前版本通过了这 40 条回归案例，**不代表任意用户目录或任意任务都能达到 100% 准确率**。

自动测试使用留有余量的防回退门槛：总体 Top 1 不低于 95%、Top 3 不低于 98%、MRR 不低于 0.97、已知错误率为 0，且每种语言 Top 1 不低于 90%。运行完整测试即可触发门槛：

```bash
npm test
```

基准有以下边界：

- 只使用仓库内的匿名固定数据，不读取本机 `catalog.json` 或会话日志。
- 它适合发现排序回退，不能替代真实用户目录验证。
- 新增案例应删除用户名、绝对路径、私有 skill 名称和其他敏感信息。
- 真实反馈仍是扩充任务表达、skill 类型和错误候选清单的主要来源。

## 常用参数

| 参数 | 作用 | 示例 |
|---|---|---|
| `--top <N>` | 指定推荐数量，最多 20 | `skm recommend "生成封面图" --top 5` |
| `--tool claude\|codex\|cursor\|gemini\|workbuddy\|kimi\|pi` | 只推荐某一客户端可用的 skill | `skm recommend "图片卡片" --tool pi` |
| `--category <关键字>` | 限制分类范围 | `skm recommend "封面图" --category 图像` |
| `--why` | 显示分数、命中词、方向识别 | `skm recommend "markdown to html" --why` |
| `--advisor codex\|claude` | 调用本机 AIDE CLI 做增强判断 | `skm recommend "生成知识图谱" --advisor codex` |
| `--json` | 输出结构化结果 | `skm recommend "写邮件" --json` |

## 增强模式边界

增强模式只在显式传 `--advisor` 时触发。

它不会增加 npm 依赖，只使用 Node.js 内置 `child_process` 调用本机已有 CLI。发送给 advisor 的是按本地相关性压缩后的精简候选清单：skill 名称、分类、工具来源、description、使用次数、本地分数与理由。

候选压缩优先保留本地排名靠前、分类相关、历史真实使用较多的条目，避免把整份目录交给外部判断。

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
