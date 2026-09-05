# Safety Boundaries and Data Notes

`skm` is designed to show facts first and let the user decide whether to clean anything.

## Read-Only by Default

Most commands do not modify Claude Code, Codex, Cursor, Gemini, WorkBuddy, Kimi, or Pi configs, skills, MCP servers, or session logs:

```bash
skm
skm doctor
skm risks
skm report
skm scan
skm list
skm search
skm recommend
skm ask
skm outdated
skm state plan
skm state list
skm lock
skm policy check
skm profile list
skm eval
skm history
skm graph
skm dupes
skm audit
skm sessions
```

Some commands update skm's own files under `~/.skill-manager`, such as catalog, usage cache, audit history, session index, update cache, lock file, policy, profiles, and lifecycle history. These files do not change any supported AIDE's behavior. Plain `scan` makes no network request for version checks; only `scan --online` / `outdated --online` read registered upstream sources, and they never update skills automatically.

`sources discover` contacts the official GitHub API only after user consent. It sends the skill name only, not local paths, skill content, or the inventory. Public candidate `SKILL.md` files are read for verification, and no source is written before user selection. `GITHUB_TOKEN` is used only as a request header and is neither cached nor printed.

Explicitly running `skm setup` or `node scripts/install.mjs` is the install-time exception: it installs the bundled `skill-navigator` bridge skill into `~/.claude/skills/`, `~/.codex/skills/`, and `~/.pi/agent/skills/`. If a target directory already exists with different content, skm backs it up before replacing it.

`skm state plan` and `skm state list` are read-only. Only explicit `skm state set` writes Claude Code settings.

`skm install`, `skm update`, `skm rollback`, and `skm profile apply` are explicit lifecycle write operations. They require confirmation by default and support `--dry-run`.

## CLI Write Operations

| Action | What changes | Safeguards |
|---|---|---|
| `setup` | Installs the `skill-navigator` bridge skill | Explicit command, supports `--dry-run`, backs up existing different content before replacement |
| `install <source>` | Installs a skill into user skill directories | Stages, validates, and audits every package target first; policy blocks high-risk findings; existing targets are refused; confirmation and `--dry-run` |
| `update <skill>` | Replaces complete packages for selected instances | Rejects ambiguity and plugin instances; file diff and high-risk gate; instance package backup; atomic rename with restoration on failure; `--dry-run` |
| `rollback <skill>` | Restores an instance package snapshot | Reads only that instance's backups; backs up current package; atomic replacement; confirmation and `--dry-run` |
| `profile apply <name>` | Writes Claude Code `skillOverrides` | Claude Code user settings only, backs up settings first, confirmation required, `--dry-run` available |
| `state set <skill>` | Writes Claude Code `skillOverrides` | Claude native states only, backs up settings before writing, confirmation required, `--dry-run` available |
| `sessions --clean` | Deletes session log files | Requires retention policy, prints plan first, confirmation or `--yes`, never deletes sessions active within 24 hours, aggregates usage before deletion |
| `disable/enable <skill>` | Renames skill directories | Reversible, no deletion, plugin skills are refused |
| `disable/enable --mcp` | Edits `~/.claude.json` / `config.toml` | Per-operation backups, confirmation, Codex line comments are reversible, restore never overwrites manually recreated config |

## MCP Safety

MCP scanning never reads `env` values. It records only the server name, tool source, transport, and command metadata needed for inventory and governance.

Before disabling MCP servers, run:

```bash
skm list --mcp
skm audit
skm risks
```

Usage auditing only uses observable session logs. Claude Code, Codex, and Pi provide fuller skill-usage signals; Cursor, Gemini, WorkBuddy, and Kimi are scanned conservatively without reading sensitive editor caches or inventing usage counts from directory presence.

## Skill Package Safety

Repository and directory sources copy complete packages, but skm never executes their scripts. Install and update scan `SKILL.md` and recognized package text/code files, and findings identify the evidence file. Policy blocks high-severity findings by default. `--allow-risk` is not an automatic trust switch; use it only after manually reviewing the exact files and diff.

Candidates are written to a hidden staging directory beside the target and must contain a regular `SKILL.md` file. Commit uses directory rename and attempts to restore the old directory on failure. A direct `SKILL.md` update starts from the installed directory, preserving scripts and assets. Symlinked installs update the real directory and preserve the link.

## Session Cleanup

Always start with dry-run:

```bash
skm sessions --clean --days 30 --keep 3 --dry-run
```

Before deletion, skm aggregates usage stats into cache. This preserves cumulative `skm audit` counts after old logs are removed.

## Data Files

| Path | Purpose |
|---|---|
| `~/.skill-manager/catalog.json` | Skill and MCP catalog |
| `~/.skill-manager/usage-cache.json` | Incremental usage cache |
| `~/.skill-manager/update-cache.json` | Upstream freshness check cache |
| `~/.skill-manager/sources.json` | Version-2 source map with legacy name records and instance package hashes |
| `~/.skill-manager/skill-lock.json` | Version-3 lifecycle lock with installation identity and package hash |
| `~/.skill-manager/lifecycle-history.json` | skm lifecycle event log |
| `~/.skill-manager/policy.json` | Lifecycle policy |
| `~/.skill-manager/profiles.json` | Claude Code scenario state profiles |
| `~/.skill-manager/skill-backups/` | Complete package snapshots isolated by installation (`payload/` + `metadata.json`) |
| `~/.skill-manager/audit-history/` | Audit snapshots |
| `~/.skill-manager/backups/` | MCP config and Claude state-setting backups |
| `~/.skill-manager/rules.json` | User classification rules |
