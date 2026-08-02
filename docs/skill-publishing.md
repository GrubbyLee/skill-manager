# skill-navigator 平台发布

`integrations/skill-navigator` 是本项目附属桥接 skill 的唯一发布目录。GitHub 主仓是唯一真源，第三方平台优先索引该目录；只有无法索引 GitHub 的平台，才上传发布包。

## 发布前准备

```bash
npm run skill:release:prepare -- --archive
```

该命令会校验：

- `SKILL.md`、中英文 README 与 `skillhub.json` 是否齐全。
- `SKILL.md`、`skillhub.json`、`package.json` 的版本是否一致。
- 发布文件中是否出现常见密钥格式。
- 生成 `.skill-release/skill-navigator`、`.skill-release/release-summary.md`，若系统存在 `zip`，额外生成 `.skill-release/skill-navigator.zip`。

`.skill-release/` 是本地发布产物，不提交仓库。

## GitHub Actions

手动运行工作流：

<https://github.com/GrubbyLee/skill-manager/actions/workflows/skill-publish.yml>

输入项：

| 输入项 | 说明 |
|---|---|
| `target` | `package-only` 只打包；`clawhub` 发布 ClawHub；`skillhub` 发布 SkillHub；`all` 同时处理可自动化目标 |
| `dry_run` | 默认 `true`。先保持预览，确认无误后再改为 `false` |
| `skillhub_namespace` | SkillHub 命名空间，默认 `GrubbyLee` |
| `skillhub_registry` | SkillHub registry，默认 `https://skill.xfyun.cn` |

真实发布前需要在 GitHub 仓库配置 Secrets：

| Secret | 用途 |
|---|---|
| `CLAWHUB_TOKEN` | ClawHub 无头登录发布 |
| `SKILLHUB_TOKEN` | SkillHub 发布；该 CLI 的 dry-run 也要求认证 |

## 平台策略

| 平台 | 自动化级别 | 处理方式 |
|---|---|---|
| ClawHub | 自动 | workflow 使用 `clawhub skill publish`，支持 `--dry-run` |
| SkillHub / skillhub.cn | 自动 | workflow 使用 `skillhub publish`，支持 `--dry-run` |
| skills-hub.ai | 半自动 | CLI 公开 `skills-hub publish [path]`，但公开文档只说明 GitHub 交互登录；先用 `.skill-release` 发布包人工登录发布 |
| claudeskills.info | 索引型 | 首次提交 GitHub source URL，后续等待平台重新索引 |
| mcpservers.org Agent Skills | 索引型 | 首次提交 GitHub source URL，后续等待平台重新索引或后台编辑 |
| skillhub.club | 索引型 | 保持 GitHub 目录结构和 metadata 正确，平台自动索引公开仓库 |
| CowAgent Skill Hub | 半自动 | 上传 `.skill-release/skill-navigator` 或 zip 包，等待审核 |
| awesome-claude-skills | 半自动 | 使用 `.skill-release/awesome-pr-entry.md` 提 PR |
| awesome-openclaw-skills | 半自动 | 先发布 ClawHub，再按对方仓库规范提 PR |

## 推荐发布顺序

1. 先运行 `package-only + dry_run=true`，确认发布包和摘要。
2. 配好 `CLAWHUB_TOKEN` 后运行 `target=clawhub + dry_run=true`。
3. ClawHub dry-run 通过后运行 `target=clawhub + dry_run=false`。
4. 配好 `SKILLHUB_TOKEN`、确认 namespace 后按同样节奏发布 SkillHub；注意 SkillHub dry-run 也需要 token。
5. 用 `.skill-release/release-summary.md` 处理索引型和人工审核平台。
