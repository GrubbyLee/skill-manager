# Safety Boundaries and Data Notes

`skm` is designed to show facts first and let the user decide whether to clean anything.

## Read-Only by Default

Most commands do not modify Claude/Codex configs, skills, MCP servers, or session logs:

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
skm graph
skm dupes
skm audit
skm sessions
```

Some commands update skm's own files under `~/.skill-manager`, such as catalog, usage cache, audit history, and session index. These files do not change Claude Code or Codex behavior.

## Write Operations

| Action | What changes | Safeguards |
|---|---|---|
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
| `~/.skill-manager/audit-history/` | Audit snapshots |
| `~/.skill-manager/backups/` | MCP config backups |
| `~/.skill-manager/rules.json` | User classification rules |
