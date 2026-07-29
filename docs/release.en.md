# Release Process

This project uses npm Trusted Publishing. GitHub Actions obtains short-lived publish credentials through OIDC, so the repository does not need an `NPM_TOKEN`.

## npmjs.com Setup

Enable Trusted Publisher in the npm package settings:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `GrubbyLee` |
| Repository | `skill-manager` |
| Workflow filename | `npm-publish.yml` |
| Environment name | empty |
| Allowed actions | `npm publish` |

`Workflow filename` is the filename only. Do not include the `.github/workflows/` prefix.

## Automatic Publishing

`.github/workflows/npm-publish.yml` runs on `main` pushes that affect package contents:

1. Uses Node.js 24 and the official npm registry.
2. Runs `npm install --ignore-scripts`, `npm run check`, and `npm test`.
3. Runs `npm pack --dry-run --registry=https://registry.npmjs.org`.
4. Checks whether the current `package.json` version already exists on npm.
5. Publishes with `npm publish --provenance --registry=https://registry.npmjs.org` if the version is new.
6. Skips cleanly if the same version is already published.

## Daily Release

```bash
npm version patch
git push origin main --tags
```

A normal commit without a `package.json` version bump will not overwrite npm. This keeps commit-driven publishing practical while avoiding repeated same-version publish failures.

## Manual Trigger

Use the GitHub Actions page and run “发布到 npm” manually. `force_publish` only bypasses the version-query skip; npm still refuses to overwrite an already published version.

## Safety Boundaries

- No long-lived npm publish token.
- No committed `.npmrc`.
- GitHub-hosted runner only; self-hosted runners are not supported for Trusted Publishing.
- `package.json` `repository.url` must continue to point to `https://github.com/GrubbyLee/skill-manager`.
