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
| `skm report` | One-page overview report | `--format html`, `--output`, `--anonymize`, `--json` |
| `skm scan` | Scan skills and MCP servers | `--verbose`, `--json`, `--export json`, `--output`, `--anonymize` |
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

Writes `~/.skill-manager/catalog.json` with skill records, MCP servers, categories, install scopes, archived directories, context estimates, and a static security summary. Claude Code, Codex, Cursor, and Gemini are scanned into the same catalog; Cursor and Gemini use conservative skill-directory and MCP-config adapters. skm does not read sensitive editor caches or launch external tools.

Use `--anonymize` before sharing output. It redacts paths, real paths, config file locations, scan directories, workspaces, and MCP commands while keeping stable JSON field names.

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
skm report --format html --output skm-report.html --anonymize
skm report --json
```

The HTML report is a single local file covering health, risks, top-used skills, context cost, estimated MCP schema cost, session logs, graph summary, and next commands. Use `--anonymize` before sharing a report.

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

`audit` reads session logs to reconstruct real skill and MCP usage. It also shows static security findings recorded by `scan`, including suspicious secret access/exfiltration wording, destructive commands, remote script execution, encoded PowerShell, privileged commands, MCP command-line secrets, plain HTTP endpoints, shell evaluation, dynamic package runners, over-privileged containers, and trust-without-confirmation settings.

The security audit only reads `SKILL.md`, directory metadata, and non-`env` MCP config fields. It never executes skills or MCP servers, and it redacts suspicious command evidence before display. Parsed usage results are cached in `~/.skill-manager/usage-cache.json`.

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
