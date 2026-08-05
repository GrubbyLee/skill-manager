# skm Command Manual

This is the detailed command manual for `skill-manager` (`skm`).

## Install

npm global install:

```bash
npm i -g aide-skill-manager
skm scan
```

Optional bridge skill setup, so Claude Code and Codex can call your local `skm` from chat:

```bash
skm setup
skm setup --dry-run
```

Source install is useful for local development.

GitHub:

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
```

The source install script runs `npm link` inside the cloned repository so the `skm` command becomes available on your machine. It also installs the bundled `skill-navigator` bridge skill into `~/.claude/skills/` and `~/.codex/skills/`.

Run without global link:

```bash
node bin/skm.js scan
node bin/skm.js ask "convert a web page to markdown"
```

This is useful for a temporary CLI trial. If you want Claude Code or Codex to use the bundled bridge skill and call your local `skm` by default, run `skm setup` after npm install, or `node scripts/install.mjs` for source install.

Preview the install without writing global commands or user skill directories:

```bash
node scripts/install.mjs --dry-run
```

## Language

```bash
skm help --lang en
skm scan --lang zh-CN
SKM_LANG=en skm doctor
skm graph --format html --output skill-graph.html --lang en
```

The main CLI paths support English and Simplified Chinese, including `install`, `update`, `rollback`, `lock`, `policy`, `profile`, `eval`, and `history`. JSON field names stay stable.

## Troubleshooting Flow

```bash
skm doctor
skm scan
skm
skm risks
skm outdated
skm state plan
skm lock
skm lock verify
skm policy check
skm eval --all
skm dupes
skm audit
skm list --mcp
skm sessions
skm sessions --clean --days 30 --keep 3 --dry-run
```

Start with read-only commands. Use dry-run before install, update, rollback, profile apply, cleanup, or state changes.

## Commands

| Command | Purpose | Common options |
|---|---|---|
| `skm` / `skm status` | One-screen governance overview | `--json` |
| `skm doctor` | Environment diagnostics | `--json` |
| `skm risks` | Risk report | `--json` |
| `skm report` | One-page overview report | `--format html`, `--output`, `--anonymize`, `--json` |
| `skm scan` | Scan skills/MCP servers and show the governance overview | `--verbose`, `--json`, `--export json`, `--output`, `--anonymize` |
| `skm outdated` | Check upstream freshness metadata | `--online`, `--refresh`, `--json` |
| `skm sources` | Manage local upstream source mappings | `missing`, `add`, `list`, `remove`, `check`, `wizard` |
| `skm state` | Plan skill state governance and write Claude native states | `plan`, `list`, `set`, `--mode`, `--scope`, `--dry-run`, `--yes` |
| `skm install` | Install a local directory or remote `SKILL.md` skill | `<source>`, `--tool`, `--dry-run`, `--yes` |
| `skm update` | Update a skill from its registered source | `<skill>`, `--tool`, `--dry-run`, `--yes` |
| `skm rollback` | Roll back a skill from skm backups | `<skill>`, `--tool`, `--dry-run`, `--yes` |
| `skm lock` | Generate a lifecycle lock file | `--json` |
| `skm lock diff` | Compare current skills against the lock file | `[file]`, `--json` |
| `skm lock verify` | Verify current skills against the lock file | `[file]`, `--json` |
| `skm policy` | Lifecycle policy | `init`, `check`, `--json` |
| `skm profile` | Claude Code scenario profiles | `list`, `create`, `apply`, `--dry-run`, `--yes` |
| `skm eval` | Evaluate skill quality | `[skill]`, `--all`, `--json` |
| `skm history` | Lifecycle event log | `[skill]`, `--json` |
| `skm setup` | Install the bridge skill | `--dry-run` |
| `skm list` | List skills | `--category`, `--tool claude\|codex\|cursor\|gemini`, `--scope`, `--raw`, `--json` |
| `skm list --mcp` | List MCP servers | `--tool`, `--json` |
| `skm search <text>` | Search skills | `--json` |
| `skm recommend <task>` | Ranked recommendations | `--top`, `--tool`, `--category`, `--why`, `--advisor`, `--json` |
| `skm ask <task>` | Q&A recommendation | `--tool`, `--category`, `--json` |
| `skm graph` | Knowledge graph | `--format json\|html\|mermaid`, `--output` |
| `skm dupes` | Duplicate detection | `--json` |
| `skm audit` | Usage and static security audit | `--history`, `--json` |
| `skm sessions` | Session log distribution | `--json` |
| `skm sessions --clean` | Clean session logs | `--days`, `--keep`, `--dry-run`, `--yes` |
| `skm disable <name>` | Soft-disable skills | multiple names supported |
| `skm enable [name]` | Restore skills | no name lists disabled skills |
| `skm disable --mcp <name>` | Disable MCP server | backup and confirmation |
| `skm enable --mcp <name>` | Restore MCP server | backup and confirmation |

## scan

```bash
skm scan
skm scan --verbose
skm scan --json
skm scan --export json --output skm-scan.json --anonymize
```

Writes `~/.skill-manager/catalog.json` with skill records, MCP servers, categories, install scopes, archived directories, context estimates, upstream version/source/git metadata, and a static security summary, then prints the same governance overview as plain `skm`. Claude Code, Codex, Cursor, and Gemini are scanned into the same catalog; Cursor and Gemini use conservative skill-directory and MCP-config adapters. skm does not read sensitive editor caches or launch external tools.

Use `--anonymize` before sharing output. It redacts paths, real paths, config file locations, scan directories, workspaces, MCP commands, and upstream `source` / `repository` / `homepage` / git remote values while keeping stable JSON field names.

## status

`skm` is the same as `skm status`.

```bash
skm
skm status --json
```

The overview is grouped by base subcommands: inventory `scan/list`, risks `risks`, usage `audit`, state `state`, versions `outdated/sources`, lifecycle `lock/policy/eval/history`, duplicates `dupes`, graph `graph`, sessions `sessions`, and recommendation `ask/recommend`. Each row gives a summary, current finding, and next command. The health score is heuristic and useful for comparing your own setup before and after cleanup.

## report

```bash
skm report
skm report --format html --output skm-report.html
skm report --format html --output skm-report.html --anonymize
skm report --json
```

The HTML report is a single local file covering health, risks, top-used skills, context cost, estimated MCP schema cost, session logs, graph summary, and next commands. Use `--anonymize` before sharing a report.

## outdated

```bash
skm outdated
skm outdated --online
skm outdated --online --refresh
skm outdated --json
```

`outdated` checks whether skills have enough upstream metadata to judge freshness. Offline mode only reads the local catalog. Online mode is explicit and read-only: it compares git remote commits when a skill lives inside a git checkout, or fetches a remote `SKILL.md` when frontmatter contains a GitHub/Gitee `source` URL. Direct `source` URLs should point to a skill directory or `SKILL.md`; bare GitHub/Gitee repository URLs are only conservatively probed for a root `SKILL.md` on `main` / `master`. Results are cached in `~/.skill-manager/update-cache.json` for 24 hours.

It never updates skills automatically. Treat `outdated` as a prompt to review upstream diffs or release notes before replacing local files.

## sources

```bash
skm sources missing
skm sources wizard
skm sources add baoyu-image-gen --source https://github.com/org/repo/tree/main/baoyu-image-gen
skm sources list
skm sources check baoyu-image-gen
skm sources remove baoyu-image-gen
```

`sources` lets users fill missing upstream URLs when installed skills do not declare `source` / `repository` metadata. Records are stored in `~/.skill-manager/sources.json` and are merged into future scans and `outdated` checks. This does not edit installed skill files.

Use `sources wizard` for the fastest manual workflow: it walks through skills whose freshness is unknown, accepts an upstream skill directory or `SKILL.md` URL, and persists each answer immediately. Use `sources missing --json` if you want to script or batch-edit the missing list.

## lifecycle: install / update / rollback / lock / policy / profile / eval / history

```bash
skm install ./my-skill --tool claude --dry-run
skm install https://github.com/org/repo/tree/main/skills/my-skill --tool codex --dry-run
skm update baoyu-image-gen --dry-run
skm rollback baoyu-image-gen --dry-run
skm lock
skm lock diff
skm lock verify
skm policy init
skm policy check
skm profile list
skm profile create writing
skm profile apply writing --dry-run
skm eval --all
skm eval baoyu-image-gen --json
skm history baoyu-image-gen
```

These commands govern skills after discovery:

- `install`: fully copies local directories; remote GitHub/Gitee skill directories or `SKILL.md` URLs install the `SKILL.md` file for now. The plan and static audit are printed before install. Existing targets are not overwritten. After a successful install, skm saves the remote URL or local frontmatter `source` / `repository` / `homepage` / `version` into `~/.skill-manager/sources.json` and refreshes the catalog; if no upgrade source exists, it prints a `skm sources add` hint. Invalid source fields are reported explicitly.
- `update`: reads the registered `source` / `repository` / `homepage` and updates from a directly accessible `SKILL.md`; the old skill directory is backed up first.
- `rollback`: restores the latest backup from `~/.skill-manager/skill-backups/`; the current directory is backed up before rollback.
- `lock`: silently refreshes skm's own catalog and writes `~/.skill-manager/skill-lock.json` with each installed instance's name, tool, scope, version, source, git HEAD, and `SKILL.md` hash. `--json` prints JSON only.
- `lock diff [file]`: silently refreshes skm's own catalog, then compares added, removed, and changed skills against the lock file without changing AIDE data.
- `lock verify [file]`: silently refreshes skm's own catalog and exits non-zero on drift, suitable for CI or upgrade scripts.
- `policy init/check`: initializes or checks local governance thresholds: total skills, never-used rate, duplicate installs, source coverage, and safety findings.
- `profile create/apply`: snapshots Claude Code skill states and writes them back for scenarios; settings are backed up before apply. Codex/Cursor/Gemini state changes still use their native UI.
- `eval`: scores description quality, frontmatter, source metadata, duplication, context cost, usage, and safety signals.
- `history`: shows skm-recorded install, update, rollback, lock, policy, and profile events.

Recommended flow: run `skm scan`, fill missing sources with `skm sources wizard`, then establish a baseline with `skm lock`; later use `skm lock diff` to inspect drift and `skm lock verify` for scriptable checks. A skill installed by `skm install` can be updated later without manually editing the catalog when source metadata was available during install. Before updating, run `skm update <skill> --dry-run` and review the plan plus audit result. See [lifecycle.en.md](lifecycle.en.md).

## recommend / ask

```bash
skm ask "convert a web page to markdown"
skm recommend "create image cards" --top 5
skm recommend "markdown to html" --why
```

`ask` gives the best match and alternatives. `recommend` gives a ranked table. See [recommend.en.md](recommend.en.md).

## graph

```bash
skm graph
skm graph --format html --output skill-graph.html
skm graph --format json --output skill-graph.json
skm graph --format mermaid --output skill-graph.md
```

The HTML graph is a zero-dependency single file. See [graph.en.md](graph.en.md).

## audit

```bash
skm audit
skm audit --history
skm audit --json
```

`audit` reads session logs to reconstruct real skill and MCP usage. Claude Code and Codex provide fuller observable usage signals; Cursor and Gemini currently focus on scanning, classification, duplicate detection, static safety checks, and report visibility. skm does not read sensitive editor caches or invent usage counts when a tool does not expose a stable log signal.

It also shows static security findings recorded by `scan`, including suspicious secret access/exfiltration wording, destructive commands, remote script execution, encoded PowerShell, privileged commands, MCP command-line secrets, plain HTTP endpoints, shell evaluation, dynamic package runners, over-privileged containers, and trust-without-confirmation settings.

The security audit only reads `SKILL.md`, directory metadata, and non-`env` MCP config fields. It never executes skills or MCP servers, and it redacts suspicious command evidence before display. `audit` also reports offline upstream metadata coverage, so you can see how many skills can be checked by `skm outdated --online`. Parsed usage results are cached in `~/.skill-manager/usage-cache.json`.

## state

```bash
skm state plan
skm state plan --json
skm state list
skm state set baoyu-image-gen --tool claude --mode name-only
skm state set old-skill --tool claude --mode off --scope user
skm state set old-skill --tool claude --mode user-only --dry-run
```

`state` handles the lifecycle problem behind "too many skills". It does not delete skills. The recommended order is: use `state plan` first, apply native Claude Code states when appropriate, and use `skm disable <skill>` only as a reversible directory-level fallback when native AIDE state is unavailable.

`state plan` uses these signals:

- Duplicate and never used: prefer `off`
- Never used with high context cost: prefer `user-only`
- Stale or occasional usage: prefer `name-only`
- Frequently used with no obvious load issue: keep `on`

Claude Code can be written automatically through `skillOverrides`. `user-only` is stored as the official `user-invocable-only` value. skm backs up the settings file before writing and asks for `yes` by default. For Codex, use the built-in `/skills` -> Enable/Disable Skills UI for now; skm does not guess or rewrite an unstable state file.

## sessions

```bash
skm sessions
skm sessions --json
skm sessions --clean --days 30 --keep 3 --dry-run
```

Cleanup keeps the union of `--days`, `--keep`, and the 24-hour safety window.

## disable / enable

```bash
skm disable gsap-plugins
skm enable gsap-plugins
skm enable
skm disable --mcp drawio
skm enable --mcp drawio
```

Skill disable is reversible directory renaming. MCP disable edits config files only after confirmation and backup.
