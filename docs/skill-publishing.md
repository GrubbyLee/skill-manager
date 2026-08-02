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
| `target` | `package-only` 只打包；`clawhub` 发布 ClawHub；`skills-hub` 发布 skills-hub.ai；`all` 同时处理可自动化目标 |
| `dry_run` | 默认 `true`。ClawHub 只预览；skills-hub.ai 创建草稿。确认无误后再改为 `false` |

真实发布前需要在 GitHub 仓库配置 Secrets：

| Secret | 用途 |
|---|---|
| `CLAWHUB_TOKEN` | ClawHub 无头登录发布 |
| `SKILLS_HUB_API_KEY` | skills-hub.ai API key 发布 |

## 平台策略

| 平台 | 自动化级别 | 处理方式 |
|---|---|---|
| ClawHub | 自动 | workflow 使用 `clawhub skill publish`，支持 `--dry-run` |
| skills-hub.ai | 自动 | workflow 使用 `skills-hub login --api-key` 与 `skills-hub publish`；`dry_run=true` 时创建草稿 |
| claudeskills.info | 索引型 | 首次提交 GitHub source URL，后续等待平台重新索引 |
| mcpservers.org Agent Skills | 索引型 | 首次提交 GitHub source URL，后续等待平台重新索引或后台编辑 |
| skillhub.club | 索引型 | 保持 GitHub 目录结构和 metadata 正确，平台自动索引公开仓库 |
| SkillHub 国内平台 | 待接入 | 需要确认 registry 与 token 来源后再接入，避免和 skills-hub.ai 混淆 |
| CowAgent Skill Hub | 半自动 | 上传 `.skill-release/skill-navigator` 或 zip 包，等待审核 |
| awesome-claude-skills | 半自动 | 使用 `.skill-release/awesome-pr-entry.md` 提 PR |
| awesome-openclaw-skills | 半自动 | 先发布 ClawHub，再按对方仓库规范提 PR |

## 推荐发布顺序

1. 先运行 `package-only + dry_run=true`，确认发布包和摘要。
2. 配好 `CLAWHUB_TOKEN` 后运行 `target=clawhub + dry_run=true`。
3. ClawHub dry-run 通过后运行 `target=clawhub + dry_run=false`。
4. 配好 `SKILLS_HUB_API_KEY` 后运行 `target=skills-hub + dry_run=true` 创建草稿。
5. 草稿确认无误后运行 `target=skills-hub + dry_run=false` 正式公开。
6. 用 `.skill-release/release-summary.md` 处理索引型和人工审核平台。
