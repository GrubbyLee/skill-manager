# skill-navigator Publishing

`integrations/skill-navigator` is the only publishable directory for the bundled bridge skill. GitHub is the source of truth. Third-party hubs should index that source directory when possible; upload the generated package only when a hub cannot index GitHub.

## Prepare Locally

```bash
npm run skill:release:prepare -- --archive
```

The command validates:

- `SKILL.md`, English/Chinese README files, and `skillhub.json` exist.
- `SKILL.md`, `skillhub.json`, and `package.json` use the same version.
- Publish files do not contain common secret formats.
- `.skill-release/skill-navigator` and `.skill-release/release-summary.md` are generated. If `zip` exists, `.skill-release/skill-navigator.zip` is generated too.

`.skill-release/` is a local artifact directory and is not committed.

## GitHub Actions

Run the workflow manually:

<https://github.com/GrubbyLee/skill-manager/actions/workflows/skill-publish.yml>

Inputs:

| Input | Description |
|---|---|
| `target` | `package-only`, `clawhub`, `skillhub`, or `all` |
| `dry_run` | Defaults to `true`. Keep it enabled before real publishing |
| `skillhub_namespace` | SkillHub namespace, default `GrubbyLee` |
| `skillhub_registry` | SkillHub registry, default `https://skill.xfyun.cn` |

Repository secrets for real publishing:

| Secret | Purpose |
|---|---|
| `CLAWHUB_TOKEN` | Headless ClawHub publishing |
| `SKILLHUB_TOKEN` | SkillHub publishing; this CLI also requires authentication for dry-run |

## Platform Strategy

| Platform | Automation level | Handling |
|---|---|---|
| ClawHub | Automated | Workflow runs `clawhub skill publish` with `--dry-run` support |
| SkillHub / skillhub.cn | Automated | Workflow runs `skillhub publish` with `--dry-run` support |
| skills-hub.ai | Semi-automated | The CLI documents `skills-hub publish [path]`, but public docs only document GitHub interactive login; use the generated package until headless auth is documented |
| claudeskills.info | Indexed | Submit the GitHub source URL once, then rely on platform re-indexing |
| mcpservers.org Agent Skills | Indexed | Submit the GitHub source URL once, then rely on platform re-indexing or dashboard edits |
| skillhub.club | Indexed | Keep GitHub source and metadata valid so the platform can index the public repository |
| CowAgent Skill Hub | Semi-automated | Upload `.skill-release/skill-navigator` or the zip file and wait for review |
| awesome-claude-skills | Semi-automated | Use `.skill-release/awesome-pr-entry.md` in a PR |
| awesome-openclaw-skills | Semi-automated | Publish to ClawHub first, then submit a PR following that repository's rules |

## Recommended Order

1. Run `package-only + dry_run=true`.
2. Configure `CLAWHUB_TOKEN`, then run `target=clawhub + dry_run=true`.
3. If the dry-run passes, run `target=clawhub + dry_run=false`.
4. Configure `SKILLHUB_TOKEN` and namespace, then publish SkillHub with the same dry-run-first flow. SkillHub dry-run also requires the token.
5. Use `.skill-release/release-summary.md` for indexed and manually reviewed platforms.
