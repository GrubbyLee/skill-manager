# 发布流程

本项目使用 npm Trusted Publishing。GitHub Actions 通过 OIDC 获取短期发布凭据，不需要在仓库里配置 `NPM_TOKEN`。

## npmjs.com 端配置

首次启用时，需要在 npm 包设置里手动添加 Trusted Publisher：

| 字段 | 值 |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `GrubbyLee` |
| Repository | `skill-manager` |
| Workflow filename | `npm-publish.yml` |
| Environment name | 留空 |
| Allowed actions | `npm publish` |

注意：`Workflow filename` 只填文件名，不填 `.github/workflows/` 前缀。

## 自动发布规则

`.github/workflows/npm-publish.yml` 只在推送 `v*` tag 时运行：

1. 校验 `v<版本>` 与 `package.json` 中的 `version` 完全一致；不一致直接失败，拒绝发布。
2. 使用 Node.js 24 和 npm 官方源。
3. 执行 `npm install --ignore-scripts`、`npm run check`、`npm test`。
4. 执行 `npm pack --dry-run --registry=https://registry.npmjs.org`。
5. 查询 `package.json` 当前版本是否已经存在于 npm。
6. 如果版本尚未发布，执行 `npm publish --provenance --registry=https://registry.npmjs.org`。
7. 如果版本已发布，工作流正常跳过发布，不报错。

这样做的好处是：发布动作显式可控，不会因为一次普通提交或文档改动意外发版；tag 本身就是发布记录。

## 日常发布步骤

```bash
# 先把版本号改好并提交
npm version patch
git push origin main --tags
```

`npm version` 会同时更新 `package.json` 版本、创建 `v<版本>` git tag 并做一次本地提交。推送后，GitHub Actions 会自动发布到 npm。

如果只推送普通代码不打 tag，不会触发发布。

## 手动触发

在 GitHub Actions 页面选择“发布到 npm”，可手动运行。`force_publish` 只用于版本查询异常时继续尝试；如果同版本已经发布，npm 仍会拒绝覆盖。

## 安全边界

- 不使用长期 npm 发布 token。
- 不提交 `.npmrc`。
- 发布只允许 GitHub-hosted runner，不能用 self-hosted runner。
- `package.json` 的 `repository.url` 必须保持指向 `https://github.com/GrubbyLee/skill-manager`。
- 发布以 tag 为唯一触发入口，避免常规代码提交误触发。
