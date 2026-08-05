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
| `skm install <source>` | Install a local skill directory or remote `SKILL.md` | User skill directory |
| `skm update <skill>` | Update a skill from its registered source | User skill directory; backup under `~/.skill-manager/skill-backups/` |
| `skm rollback <skill>` | Roll back from skm backup | User skill directory; backs up current directory first |
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

Local directories are copied fully. Remote GitHub/Gitee skill directories or `SKILL.md` URLs currently install the `SKILL.md` file only; repository scripts or asset directories are not pulled automatically. Existing targets are refused.

After a successful install, `skm` records usable source metadata in `~/.skill-manager/sources.json`:

- Remote URL install: records the install URL.
- Local directory install: reads `source` / `repository` / `homepage` / `version` from `SKILL.md` frontmatter.
- Local directory without a source: install still succeeds, but skm prints a `skm sources add <skill> --source <url>` hint.
- Invalid source fields: skm prints which field was ignored, so users do not assume an upgrade source was recorded.

This lets `skm update <skill>` find the upgrade source later without manual catalog edits. After a successful install, skm refreshes the local catalog automatically, so users can usually run `skm update <skill> --dry-run` immediately to verify the loop.

## Update and Rollback

`update` depends on a directly readable `source` / `repository` / `homepage`. If a skill was installed by `skm install` and source metadata was recorded, it can usually be updated directly. If a skill has no source, add one first:

```bash
skm sources add my-skill --source https://github.com/org/repo/tree/main/skills/my-skill
```

Before updating, skm prints the plan and static audit result. The old directory is backed up before writing. `rollback` restores the latest backup and backs up the current directory first.

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

The lock file records each installed skill instance with name, tool, scope, version, source, git HEAD, and `SKILL.md` hash. Same-name skills installed in Claude Code, Codex, Cursor, or Gemini are locked and verified separately. `lock`, `diff`, and `verify` silently refresh skm's own catalog first, then generate or compare added, removed, and changed entries against the lock file. Older lock files or duplicate lock keys fail fast to avoid hidden overwrite during comparison. `verify` exits non-zero on drift, so it can be used in CI or personal upgrade scripts. Policy checks cover total skills, never-used rate, duplicate installs, source coverage, and safety findings. The policy file is local data and can be edited to fit your team.

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

Start with `--dry-run`. Remote install and update read only `SKILL.md`; they do not execute scripts, read secrets, or read MCP `env` values. Any lifecycle action that modifies AIDE files requires an explicit command and confirmation.
