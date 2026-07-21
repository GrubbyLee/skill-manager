# skm Command Manual

This is the detailed command manual for `skill-manager` (`skm`).

## Install

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
```

Run without global link:

```bash
node bin/skm.js scan
node bin/skm.js ask "convert a web page to markdown"
```

## Language

```bash
skm help --lang en
skm scan --lang zh-CN
SKM_LANG=en skm doctor
```

Most CLI output supports English and Simplified Chinese. JSON field names stay stable.

## Troubleshooting Flow

```bash
skm doctor
skm scan
skm
skm risks
skm dupes
skm audit
skm list --mcp
skm sessions
skm sessions --clean --days 30 --keep 3 --dry-run
```

Start with read-only commands. Use dry-run before cleanup.

## Commands

| Command | Purpose | Common options |
|---|---|---|
| `skm` / `skm status` | One-screen health check | `--json` |
| `skm doctor` | Environment diagnostics | `--json` |
| `skm risks` | Risk report | `--json` |
| `skm report` | One-page overview report | `--format html`, `--output`, `--json` |
| `skm scan` | Scan skills and MCP servers | `--verbose`, `--json` |
| `skm list` | List skills | `--category`, `--tool`, `--scope`, `--raw`, `--json` |
| `skm list --mcp` | List MCP servers | `--tool`, `--json` |
| `skm search <text>` | Search skills | `--json` |
| `skm recommend <task>` | Ranked recommendations | `--top`, `--tool`, `--category`, `--why`, `--advisor`, `--json` |
| `skm ask <task>` | Q&A recommendation | `--tool`, `--category`, `--json` |
| `skm graph` | Knowledge graph | `--format json\|html\|mermaid`, `--output` |
| `skm dupes` | Duplicate detection | `--json` |
| `skm audit` | Usage audit | `--history`, `--json` |
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
```

Writes `~/.skill-manager/catalog.json` with skill records, MCP servers, categories, install scopes, archived directories, and context estimates.

## status

`skm` is the same as `skm status`.

```bash
skm
skm status --json
```

The health score is heuristic. It is useful for comparing your own setup before and after cleanup.

## report

```bash
skm report
skm report --format html --output skm-report.html
skm report --json
```

The HTML report is a single local file covering health, risks, top-used skills, context cost, session logs, graph summary, and next commands.

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

`audit` reads session logs to reconstruct real skill and MCP usage. It caches parsed results in `~/.skill-manager/usage-cache.json`.

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
