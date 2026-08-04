# Safety Boundaries and Data Notes

`skm` is designed to show facts first and let the user decide whether to clean anything.

## Read-Only by Default

Most commands do not modify Claude Code, Codex, Cursor, or Gemini configs, skills, MCP servers, or session logs:

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

Some commands update skm's own files under `~/.skill-manager`, such as catalog, usage cache, audit history, session index, update cache, lock file, policy, profiles, and lifecycle history. These files do not change Claude Code, Codex, Cursor, or Gemini behavior. `skm outdated --online` only reads GitHub/Gitee or git remotes and never updates skills automatically.

Explicitly running `skm setup` or `node scripts/install.mjs` is the install-time exception: it installs the bundled `skill-navigator` bridge skill into `~/.claude/skills/` and `~/.codex/skills/`. If a target directory already exists with different content, skm backs it up before replacing it.

`skm state plan` and `skm state list` are read-only. Only explicit `skm state set` writes Claude Code settings.

`skm install`, `skm update`, `skm rollback`, and `skm profile apply` are explicit lifecycle write operations. They require confirmation by default and support `--dry-run`.

## CLI Write Operations

| Action | What changes | Safeguards |
|---|---|---|
| `setup` | Installs the `skill-navigator` bridge skill | Explicit command, supports `--dry-run`, backs up existing different content before replacement |
| `install <source>` | Installs a skill into user skill directories | Explicit command, static audit before install, refuses to overwrite existing targets, confirmation required, `--dry-run` available |
| `update <skill>` | Replaces an installed skill | Requires a readable source, backs up the old directory into `~/.skill-manager/skill-backups/`, confirmation required, `--dry-run` available |
| `rollback <skill>` | Restores a skill from skm backup | Backs up the current directory before rollback, confirmation required, `--dry-run` available |
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

Usage auditing only uses observable session logs. Claude Code and Codex provide fuller usage signals; Cursor and Gemini are scanned conservatively without reading sensitive editor caches or inventing usage counts from directory presence.

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
| `~/.skill-manager/skill-lock.json` | Skill lifecycle lock file |
| `~/.skill-manager/lifecycle-history.json` | skm lifecycle event log |
| `~/.skill-manager/policy.json` | Lifecycle policy |
| `~/.skill-manager/profiles.json` | Claude Code scenario state profiles |
| `~/.skill-manager/skill-backups/` | Skill directory backups before update/rollback |
| `~/.skill-manager/audit-history/` | Audit snapshots |
| `~/.skill-manager/backups/` | MCP config and Claude state-setting backups |
| `~/.skill-manager/rules.json` | User classification rules |
