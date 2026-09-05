# skm Command Manual

This is the detailed command manual for `skill-manager` (`skm`).

## Install

npm global install:

```bash
npm i -g aide-skill-manager
skm scan
```

Optional bridge skill setup, so Claude Code, Codex, and Pi can call your local `skm` from chat:

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

Start with read-only commands. Use dry-run before install, update, rollback, profile apply, disable/enable, cleanup, or state changes.

## Commands

| Command | Purpose | Common options |
|---|---|---|
| `skm` / `skm status` | One-screen governance overview | `--json` |
| `skm doctor` | Environment diagnostics | `--json` |
| `skm risks` | Risk report | `--json` |
| `skm report` | One-page overview report | `--format html`, `--output`, `--anonymize`, `--json` |
| `skm web` | Local Web governance dashboard (source and version actions require confirmation) | `--port` |
| `skm scan` | Scan skills/MCP servers and show the governance overview; version checks use cache by default | `--online`, `--refresh`, `--verbose`, `--json`, `--export json`, `--output`, `--anonymize` |
| `skm outdated` | Check upstream freshness metadata | `--online`, `--refresh`, `--json` |
| `skm sources` | Manage name-level or instance-level sources | `missing`, `add`, `discover`, `list`, `remove`, `check`, `wizard`, `--instance`, `--all` |
| `skm state` | Plan skill state governance and write Claude native states | `plan`, `list`, `set`, `--mode`, `--scope`, `--dry-run`, `--yes` |
| `skm install` | Install a complete directory/repository package or direct `SKILL.md` | `<source>`, `--tool`, `--allow-risk`, `--dry-run`, `--yes` |
| `skm update` | Transactionally update selected instances | `<skill>`, `--tool`, `--scope`, `--instance`, `--all`, `--allow-risk`, `--dry-run`, `--yes` |
| `skm rollback` | Restore instance-scoped package snapshots | `<skill>`, `--tool`, `--scope`, `--instance`, `--all`, `--dry-run`, `--yes` |
| `skm lock` | Generate a lifecycle lock file | `--json` |
| `skm lock diff` | Compare current skills against the lock file | `[file]`, `--json` |
| `skm lock verify` | Verify current skills against the lock file | `[file]`, `--json` |
| `skm policy` | Lifecycle policy | `init`, `check`, `--json` |
| `skm profile` | Claude Code scenario profiles | `list`, `create`, `apply`, `--dry-run`, `--yes` |
| `skm eval` | Evaluate skill quality | `[skill]`, `--all`, `--json` |
| `skm history` | Lifecycle event log | `[skill]`, `--json` |
| `skm setup` | Install the bridge skill | `--dry-run` |
| `skm list` | List skills | `--category`, `--tool claude\|codex\|cursor\|gemini\|workbuddy\|kimi\|pi`, `--scope`, `--raw`, `--json` |
| `skm list --mcp` | List MCP servers | `--tool`, `--json` |
| `skm search <text>` | Search skills | `--json` |
| `skm recommend <task>` | Ranked recommendations | `--top`, `--tool`, `--category`, `--why`, `--advisor`, `--json` |
| `skm ask <task>` | Q&A recommendation | `--tool`, `--category`, `--json` |
| `skm graph` | Knowledge graph | `--format json\|html\|mermaid`, `--output` |
| `skm dupes` | Duplicate detection | `--json` |
| `skm audit` | Usage and static security audit | `--history`, `--json` |
| `skm sessions` | Session log distribution | `--json` |
| `skm sessions --clean` | Clean session logs | `--days`, `--keep`, `--dry-run`, `--yes` |
| `skm disable <name>` | Soft-disable skills | multiple names supported, `--dry-run` |
| `skm enable [name]` | Restore skills | no name lists disabled skills; named restore supports `--dry-run` |
| `skm disable --mcp <name>` | Disable MCP server | backup and confirmation; supports `--dry-run` |
| `skm enable --mcp <name>` | Restore MCP server | backup and confirmation; supports `--dry-run` |

## scan

```bash
skm scan
skm scan --verbose
skm scan --json
skm scan --export json --output skm-scan.json --anonymize
```

Writes `~/.skill-manager/catalog.json` with skill records, MCP servers, categories, install scopes, archived directories, context estimates, upstream version/source/git metadata, and a static security summary, then prints the same governance overview as plain `skm`. Claude Code, Codex, Cursor, Gemini, WorkBuddy, Kimi, and Pi are scanned into the same catalog. Pi follows the Agent Skills standard and scans `~/.pi/agent/skills`, project `.pi/skills`, and shared `.agents/skills`; Pi has no MCP config layer. skm does not read sensitive editor caches or launch external tools.

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

## web

```bash
skm web
skm web --port 17362
```

`web` starts a local Web governance dashboard on `127.0.0.1`. The page includes overview, a skill inventory with usage/context sorting, pagination above and below the table, source provenance, upstream freshness, an actionable 3D knowledge graph, recommendation entry, and command center. Missing or partially tracked sources open an explicit confirmation flow for manual URL entry or authorized GitHub discovery; public `SKILL.md` candidates are verified and never saved before selection. Version cells show latest, outdated, diverged, ahead, unchecked, and unknown states, with instance-specific `update --dry-run` previews for outdated or diverged skills. Top-right controls provide local inventory refresh, cached version checks, and a force refresh that explicitly queries recorded sources. Graph insights expose suites, overlaps, workflows, and inferred MCP links; concrete suite/platform/category scopes isolate useful subgraphs, while node details show one-hop focus, confidence-tagged evidence, suggested commands, and inventory navigation. Read-only commands can run locally in embedded terminals. Source writes, network searches, version checks, and update previews use dedicated same-origin APIs and require explicit user actions; the Web console never performs a real update, install, rollback, disable, or MCP/skill execution. It uses Node.js built-in `http` plus native HTML/CSS/JS, keeping the project dependency-free. The interface includes Cyberpunk, Galaxy, and Sky themes plus a 3D loading cube. When facts are missing or manually refreshed, the dashboard may read AIDE skill/MCP metadata and refresh skm's own `~/.skill-manager/catalog.json` or cache files. It does not modify AIDE data or read MCP `env` values.

## outdated

```bash
skm outdated
skm outdated --online
skm outdated --online --refresh
skm outdated --json
```

`outdated` reports whether local state is `latest`, `outdated`, `ahead`, or `diverged`. Offline mode reads only the catalog. Online mode is explicit and read-only: git checkouts compare remote commits; repository/directory sources with a recorded package hash are reacquired and compared using SemVer plus the complete package hash, so resource-only changes are visible; legacy direct `SKILL.md` sources use version and content hashes. Results are cached for 24 hours.

It never updates skills automatically. Treat `outdated` as a prompt to review upstream diffs or release notes before replacing local files.

## sources

```bash
skm sources missing
skm sources wizard
skm sources discover baoyu-image-gen
skm sources discover baoyu-image-gen --yes --json
skm sources discover baoyu-image-gen --yes --select 1
skm sources add baoyu-image-gen --source https://github.com/org/repo/tree/main/baoyu-image-gen
skm sources add baoyu-image-gen --source <url> --instance <installation-id>
skm sources check baoyu-image-gen --tool codex --scope user
skm sources list
skm sources check baoyu-image-gen
skm sources remove baoyu-image-gen
```

`sources` fills missing upstream metadata. The version-2 file stores both legacy name-level mappings and installation-instance records. Same-name installations require `--tool`, `--scope`, or `--instance`, unless `--all` is intentional. Instance records take priority and never leak to an unmatched same-name install. This does not edit installed skill files.

`sources wizard` offers two choices for each missing source: enter an upstream URL, or enter `2` to request a GitHub search. Search requires explicit consent, sends only the skill name, and never uploads local paths or content. Candidates must expose a parseable `SKILL.md`, and nothing is saved until the user selects one. Non-interactive discovery requires `--yes`; `--json` only prints candidates, while saving also requires `--select <number>`. Set `GITHUB_TOKEN` when GitHub Code Search requires authentication or a higher rate limit.

Plain `skm scan` makes no version-check network requests and only consumes valid 24-hour cache entries. `skm scan --online` refreshes recorded sources, writes `latest`, `outdated`, `ahead`, `diverged`, or a failed-check state into the catalog, and prints an instance-specific `skm update <skill> --instance <ID> --dry-run` prompt when review is needed. If any check failed or any instance lacks source metadata, scan reports an incomplete result instead of claiming that every skill is current.

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

- `install`: local, `file://`, GitHub/Gitee, and git/SSH directory sources install complete packages; direct `SKILL.md` URLs install one file. All targets are staged, validated, and scanned before any commit. Existing targets are refused.
- `update`: reads sources per instance, prints complete package file differences, and scans package text/code files. Policy blocks high-severity findings unless `--allow-risk` is explicit after review. It then creates an isolated package backup and atomically replaces the directory. No-op updates create no backup. Direct single-file updates preserve companion files.
- `rollback`: restores the newest instance snapshot different from the current package hash and first backs up the current package, enabling reverse rollback. Symlinks remain links; plugin-managed skills are refused.
- `lock`: writes format v3 with a stable instance key, location hash, version, source, git HEAD, `SKILL.md` hash, and complete package hash. Older locks must be regenerated.
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

`audit` reads session logs to reconstruct real skill and MCP usage. Claude Code, Codex, and Pi provide fuller observable skill-usage signals; Cursor, Gemini, WorkBuddy, and Kimi currently focus on scanning, classification, duplicate detection, static safety checks, and report visibility. skm does not read sensitive editor caches or invent usage counts when a tool does not expose a stable log signal.

It also shows static security findings recorded by `scan`, including suspicious secret access/exfiltration wording, destructive commands, remote script execution, encoded PowerShell, privileged commands, MCP command-line secrets, plain HTTP endpoints, shell evaluation, dynamic package runners, over-privileged containers, and trust-without-confirmation settings.

The security audit reads `SKILL.md`, skill-package text/code files, and non-`env` MCP config fields. It never executes skills or MCP servers, redacts suspicious evidence, and reports the evidence file. `audit` also reports offline upstream metadata coverage. Parsed usage results are cached in `~/.skill-manager/usage-cache.json`.

## state

```bash
skm state plan
skm state plan --json
skm state list
skm state set baoyu-image-gen --tool claude --mode name-only
skm state set old-skill --tool claude --mode off --scope user
skm state set old-skill --tool claude --mode user-invocable-only --dry-run
```

`state` handles the lifecycle problem behind "too many skills". It does not delete skills. The recommended order is: use `state plan` first, apply native Claude Code states when appropriate, and use `skm disable <skill>` only as a reversible directory-level fallback when native AIDE state is unavailable.

`state plan` uses these signals:

- Duplicate and never used: prefer `off`
- Never used with high context cost: prefer `user-invocable-only`
- Stale or occasional usage: prefer `name-only`
- Frequently used with no obvious load issue: keep `on`

Claude Code can be written automatically through `skillOverrides`. The official state name is `user-invocable-only`; `user-only` is kept only as a compatibility alias. skm backs up the settings file before writing and asks for `yes` by default. For Codex, use the built-in `/skills` -> Enable/Disable Skills UI for now; skm does not guess or rewrite an unstable state file.

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
skm disable gsap-plugins --dry-run
skm enable gsap-plugins
skm enable
skm disable --mcp drawio
skm disable --mcp drawio --dry-run
skm enable --mcp drawio
```

Skill disable is reversible directory renaming. MCP disable edits config files only after confirmation and backup. `disable` / `enable` both support `--dry-run`; dry-run does not rename directories, write configs, create backups, or refresh the catalog.
