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

`.github/workflows/npm-publish.yml` 会在 `main` 分支收到影响发布包内容的提交后运行：

1. 使用 Node.js 24 和 npm 官方源。
2. 执行 `npm install --ignore-scripts`、`npm run check`、`npm test`。
3. 执行 `npm pack --dry-run --registry=https://registry.npmjs.org`。
4. 查询 `package.json` 当前版本是否已经存在于 npm。
5. 如果版本尚未发布，执行 `npm publish --provenance --registry=https://registry.npmjs.org`。
6. 如果版本已发布，工作流正常跳过发布，不报错。

## 日常发布步骤

```bash
npm version patch
git push origin main --tags
```

如果只是普通代码提交但没有修改 `package.json` 版本，工作流会跳过发布。这样可以做到“提交后自动发布新版本”，同时避免同版本重复发布失败。

## 手动触发

在 GitHub Actions 页面选择“发布到 npm”，可手动运行。`force_publish` 只用于版本查询异常时继续尝试；如果同版本已经发布，npm 仍会拒绝覆盖。

## 安全边界

- 不使用长期 npm 发布 token。
- 不提交 `.npmrc`。
- 发布只允许 GitHub-hosted runner，不能用 self-hosted runner。
- `package.json` 的 `repository.url` 必须保持指向 `https://github.com/GrubbyLee/skill-manager`。
