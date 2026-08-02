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
| `target` | `package-only`, `clawhub`, `skills-hub`, or `all` |
| `dry_run` | Defaults to `true`. ClawHub previews only; skills-hub.ai creates a draft |

Repository secrets for real publishing:

| Secret | Purpose |
|---|---|
| `CLAWHUB_TOKEN` | Headless ClawHub publishing |
| `SKILLS_HUB_API_KEY` | skills-hub.ai API key publishing |

## Platform Strategy

| Platform | Automation level | Handling |
|---|---|---|
| ClawHub | Automated | Workflow runs `clawhub skill publish` with `--dry-run` support |
| skills-hub.ai | Automated | Workflow runs `skills-hub login --api-key` and `skills-hub publish`; `dry_run=true` creates a draft |
| claudeskills.info | Indexed | Submit the GitHub source URL once, then rely on platform re-indexing |
| mcpservers.org Agent Skills | Indexed | Submit the GitHub source URL once, then rely on platform re-indexing or dashboard edits |
| skillhub.club | Indexed | Keep GitHub source and metadata valid so the platform can index the public repository |
| China SkillHub platforms | Pending | Confirm the registry and token issuer before wiring automation, so they are not confused with skills-hub.ai |
| CowAgent Skill Hub | Semi-automated | Upload `.skill-release/skill-navigator` or the zip file and wait for review |
| awesome-claude-skills | Semi-automated | Use `.skill-release/awesome-pr-entry.md` in a PR |
| awesome-openclaw-skills | Semi-automated | Publish to ClawHub first, then submit a PR following that repository's rules |

## Recommended Order

1. Run `package-only + dry_run=true`.
2. Configure `CLAWHUB_TOKEN`, then run `target=clawhub + dry_run=true`.
3. If the dry-run passes, run `target=clawhub + dry_run=false`.
4. Configure `SKILLS_HUB_API_KEY`, then run `target=skills-hub + dry_run=true` to create a draft.
5. After reviewing the draft, run `target=skills-hub + dry_run=false` to publish publicly.
6. Use `.skill-release/release-summary.md` for indexed and manually reviewed platforms.
