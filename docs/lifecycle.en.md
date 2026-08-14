# Skill Lifecycle Governance

`skm` lifecycle commands cover eight areas: introduce, register source, update, rollback, lock, policy, scenario profiles, and quality evaluation.

## Recommended Flow

```bash
skm scan
skm sources missing
skm sources wizard
skm lock
skm lock verify
skm policy check
skm eval --all
```

When one skill needs an update:

```bash
skm update <skill> --dry-run
skm update <skill>
skm history <skill>
```

If the update is not right:

```bash
skm rollback <skill> --dry-run
skm rollback <skill>
```

## Commands

| Command | Purpose | Writes to |
|---|---|---|
| `skm install <source>` | Install a complete local/repository package or direct `SKILL.md` | User skill directory |
| `skm update <skill>` | Transactionally update complete packages by installation instance | User skill directory; instance backup under `~/.skill-manager/skill-backups/` |
| `skm rollback <skill>` | Restore a complete package snapshot by instance | User skill directory; backs up current package first |
| `skm lock` | Generate the current skill lock file | Refreshes skm's own catalog; writes `~/.skill-manager/skill-lock.json` |
| `skm lock diff [file]` | Compare current skills against the lock file | Does not change AIDE data; refreshes skm's own catalog first |
| `skm lock verify [file]` | Verify current skills against the lock file | Does not change AIDE data; exits non-zero on drift |
| `skm policy init/check` | Initialize or check governance policy | `~/.skill-manager/policy.json` |
| `skm profile create/apply` | Save or apply Claude Code skill state profiles | `~/.skill-manager/profiles.json`; Claude settings on apply |
| `skm eval [skill]` | Evaluate skill quality | Read-only |
| `skm history [skill]` | Show lifecycle events | `~/.skill-manager/lifecycle-history.json` |

## Install

```bash
skm install ./my-skill --tool claude --dry-run
skm install ./my-skill --tool codex
skm install https://github.com/org/repo/tree/main/skills/my-skill --tool claude --dry-run
```

Local directories, `file://` directories, GitHub/Gitee skill directories, and git/SSH repositories install the complete skill package, including `scripts/`, `references/`, assets, and other companion files. Repositories are shallow-cloned and only the selected skill subtree is copied. Direct `SKILL.md` URLs remain supported as single-file sources. Every target is prepared in a hidden staging directory, checked for `SKILL.md` and package-escaping internal symlinks, then atomically committed only after all targets are ready. Existing targets are refused.

After a successful install, `skm` records usable source metadata in version-2 `~/.skill-manager/sources.json`:

- Remote URL install: records the URL and, when available, repository ref/subdir, resolved commit, and package hash.
- Local directory install: reads `source` / `repository` / `homepage` / `version` from `SKILL.md` frontmatter.
- Local directory without a source: install still succeeds, but skm prints a `skm sources add <skill> --source <url>` hint.
- Invalid source fields: skm prints which field was ignored, so users do not assume an upgrade source was recorded.

This lets `skm update <skill>` find the upgrade source later without manual catalog edits. After a successful install, skm refreshes the local catalog automatically, so users can usually run `skm update <skill> --dry-run` immediately to verify the loop.

## Instance Selection, Update, and Rollback

`update` depends on a directly readable `source` / `repository` / `homepage`. If a skill was installed by `skm install` and source metadata was recorded, it can usually be updated directly. If a skill has no source, add one first:

```bash
skm sources add my-skill --source https://github.com/org/repo/tree/main/skills/my-skill
```

Same-name skills can exist in different tools, scopes, or directories. Ambiguous writes are rejected until an instance is selected:

```bash
skm update my-skill --tool codex --scope user --dry-run
skm update my-skill --instance <installation-id>
skm update my-skill --all
skm rollback my-skill --instance <installation-id>
skm sources add my-skill --source <url> --instance <installation-id>
```

Sources and backups are isolated by stable installation ID. `--all` deliberately processes every match with its own source. Legacy name-level source records remain readable, but once an instance record exists for a same-name skill, that name-level record is not leaked to unmatched instances.

Update acquires a complete candidate package, prints file-level `added` / `changed` / `removed` differences, and scans `SKILL.md` plus package text/code files. Policy blocks high-severity findings by default; use `--allow-risk` only after manual review. On confirmation, skm creates an instance-scoped snapshot with `payload/` and `metadata.json`, then replaces the directory atomically by rename. Failures restore the old directory. A no-op creates no backup or history event. Direct `SKILL.md` updates preserve existing companion files.

`rollback` chooses the newest snapshot whose package hash differs from the current package, and backs up the current directory first, so another rollback can restore the pre-rollback state. Symlinked installs update the real directory while preserving the link. Plugin-managed skills are refused and must be changed through their plugin manager.

## Lock and Policy

```bash
skm lock
skm lock --json
skm lock diff
skm lock diff ~/.skill-manager/skill-lock.json --json
skm lock verify
skm policy init
skm policy check
```

Lock format v3 records a stable key, location hash, name, tool, scope, version, source, git HEAD, `SKILL.md` hash, and complete package hash for each installation. Companion-file changes therefore count as drift. Same-name installations across tools or locations are verified separately. `lock`, `diff`, and `verify` refresh the catalog first; old lock formats, missing package hashes, and duplicate keys fail fast and require regeneration. `verify` exits non-zero on drift for CI. Policy checks cover total skills, never-used rate, duplicate installs, source coverage, and safety findings.

## Profiles

```bash
skm profile create writing
skm profile list
skm profile apply writing --dry-run
```

`profile create` records scanned skills and tries to preserve current Claude Code `skillOverrides` states. `profile apply` writes only Claude Code user-level `settings.json`, with a backup first. Codex, Cursor, and Gemini state toggles should still use their native UI.

## Quality Evaluation

```bash
skm eval --all
skm eval baoyu-image-gen --json
```

The score deducts points for missing description, missing frontmatter, missing source, duplicate physical installs, high context cost, never-used skills, and static safety findings. The score is a governance priority signal, not a judgment of business value.

## Safety

Start with `--dry-run`. Remote repositories are downloaded for complete-package copying and static inspection, but skm does not execute their scripts, read secrets, or read MCP `env` values. Candidates pass staging, validation, policy gates, instance backups, and atomic replacement before landing. Every lifecycle action that modifies AIDE files requires an explicit command and confirmation.
