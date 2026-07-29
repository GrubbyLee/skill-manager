# skill-manager (skm)

English | [简体中文](README.zh-CN.md)

[![macOS / Windows on-demand CI](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml)
[![Linux locally validated](https://img.shields.io/badge/Linux-locally_validated-FCC624?logo=linux&logoColor=black)](#cross-platform-validation)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-3c873a)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-2f6f4e)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/GrubbyLee/skill-manager?style=social)](https://github.com/GrubbyLee/skill-manager/stargazers)

> A zero-dependency CLI to scan, recommend, deduplicate, audit, and visualize Claude Code / Codex / Cursor / Gemini skills and MCP servers.

When you keep adding skills to Claude Code, Codex, Cursor, or Gemini, the local setup can become hard to reason about: duplicated skills, shared symlinks, unused tools, unclear names, and MCP servers that keep consuming context. `skm` turns that local toolbox into something you can inspect, search, compare, audit, and clean up safely.

If `skm` helps you understand your local skill setup, a GitHub Star helps other AIDE users find the project.

[![Animated preview of the skm project tour](docs/demo.en.gif)](https://grubbylee.github.io/skill-manager/?lang=en)

*Live preview · Click to play the complete English tour with voiceover and controls.*

## 30-Second Start

```bash
npm i -g aide-skill-manager

skm scan
skm
skm ask "convert a web page to Markdown"
skm report --format html --output skm-report.html
skm graph --format html --output skill-graph.html
```

Optional bridge skill setup:

```bash
skm setup
```

`npm i -g` installs the `skm` CLI. `skm setup` is explicit because it writes the bundled `skill-navigator` bridge skill into `~/.claude/skills/` and `~/.codex/skills/`, so Claude Code and Codex can call your local `skm` command when you ask which skill to use.

Source install for local development:

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
```

CLI output supports language selection:

```bash
skm scan --lang en
SKM_LANG=zh-CN skm doctor
```

## What It Solves

| Question | Command | What you get |
|---|---|---|
| How many skills and MCP servers are installed? | `skm scan` | Claude Code / Codex / Cursor / Gemini counts, categories, install sources, context estimate, static security summary |
| Is my local AIDE setup healthy? | `skm` | Health score, zombie skills, duplicate installs, idle MCP, session size |
| Which skill should I use for this task? | `skm ask "task"` | Best match, reasons, alternatives |
| Which skills are duplicated? | `skm dupes` | Same name, same content, same category, text similarity |
| Which skills were never really used? | `skm audit` | Real usage frequency from Claude Code / Codex sessions, plus static skill/MCP security findings |
| How are skills related? | `skm graph --format html` | Filterable, draggable, single-file knowledge graph |
| What are the risky items? | `skm risks` | Prioritized risk list and conservative suggestions |
| Can I share one local overview? | `skm report --format html` | Single-file overview with health, risks, usage, sessions, graph summary |
| Can I share scan/report output safely? | `skm scan --export json --output scan.json --anonymize` | Redacted paths, config locations, workspaces, and MCP commands |
| Where did my session logs grow? | `skm sessions` | Workspace-level session log size and dry-run cleanup plan |
| Can my AIDE call `skm` directly? | `skm setup`, then ask in AIDE | The `skill-navigator` bridge skill calls local `skm` for you |

## Command Cheatsheet

| Command | Purpose |
|---|---|
| `skm` / `skm status` | One-screen health overview |
| `skm doctor` | Read-only environment diagnostics |
| `skm risks` | Risk report without changing AIDE data |
| `skm report` | One-page overview report |
| `skm scan` | Scan skills and MCP servers, rebuild catalog |
| `skm setup` | Install the optional `skill-navigator` bridge skill |
| `skm list` / `skm list --mcp` | List skills or MCP servers |
| `skm search <keyword>` | Search by name, category, and description |
| `skm recommend <task>` | Ranked skill recommendations |
| `skm ask <task>` | Q&A-style skill recommendation |
| `skm graph` | Export the skill knowledge graph |
| `skm dupes` | Detect duplicates and similar skills |
| `skm audit` | Audit real usage frequency and static safety signals |
| `skm sessions` | Inspect session log distribution |
| `skm sessions --clean` | Clean session logs with confirmation |
| `skm disable` / `skm enable` | Soft-disable or restore skills / MCP servers |

Detailed command manual: [docs/usage.en.md](docs/usage.en.md).

Bundled bridge skill: `skm setup` installs `skill-navigator` for Claude Code and Codex to call local `skm`; `skill-navigator` is not a CLI command.

## Features

- Scans Claude Code, Codex CLI, Cursor, and Gemini skills, plus common MCP config files where available
- Detects shared symlinks, duplicate physical copies, and same-content copies
- Classifies skills with local rules
- Recommends skills from natural-language task descriptions, with local usage preference boosts after relevance matching
- Audits real usage from session logs
- Adds static, read-only security audit for suspicious skill instructions and MCP launch configuration
- Finds zombie skills, idle Claude-side MCP servers, and high estimated MCP schema context cost
- Exports JSON, Mermaid, and single-file HTML knowledge graphs with richer relationship summaries
- Exports single-file HTML overview reports, with optional anonymized output for sharing
- Uses zero third-party npm dependencies
- Runs on Node.js >= 18

## Skill Recommendation

If you know what you want to do but do not remember which skill fits:

```bash
skm ask "convert a web page to Markdown"
skm recommend "create image cards for Xiaohongshu" --top 5
skm recommend "markdown to html" --why
```

By default, recommendations run locally. No external model is called, and no directory information is uploaded. The ranking combines skill name, category, description, task intent, conversion direction, usage history, recency, and which scanned tools provide the skill.

The local ranker also learns lightweight personal preferences from real usage: if two candidates are already relevant, a category or suite you often use can receive a small boost. That boost never introduces unrelated high-frequency skills into the result list.

Recommendation changes are checked against a public 40-case Chinese/English regression benchmark. Run `npm run benchmark:recommend`; see [the recommendation guide](docs/recommend.en.md#measurable-regression-benchmark) for metrics and limitations.

You can explicitly ask a local AIDE CLI to help judge the short candidate list:

```bash
skm recommend "create a knowledge graph" --advisor codex --why
skm recommend "summarize meeting notes" --advisor claude
```

Advisor mode sends only a compact, relevance-first candidate list. It does not send real skill paths, config paths, MCP `env` values, API keys, passwords, private keys, or session log bodies.

## Knowledge Graph

```bash
skm graph --format html --output skill-graph.html
```

The HTML graph is a zero-dependency single file. Open it in a browser and filter relationships from the left panel; the graph only shows nodes involved in the selected relationships. Nodes are draggable, which helps when you have many installed skills.

![skm skill knowledge graph](docs/graphic.png)

Current relationship types include same family, same category, duplicate, strong/weak alternative, workflow, upstream/downstream, shared input/output format, reverse conversion, shared platform, same-platform action, and uses MCP. Details are in [docs/graph.en.md](docs/graph.en.md).

## Overview Report

```bash
skm report --format html --output skm-report.html
skm report --format html --output skm-report.html --anonymize
```

The report puts health score, risks, usage, context cost, estimated MCP schema cost, session logs, graph summary, and next commands on one local HTML page. Use `--anonymize` before sharing a report outside your machine. Details are in [docs/report.en.md](docs/report.en.md).

## Visual Story

| Too many tools | Scan and label |
|---|---|
| ![Too many tools](docs/comic-01-tool-chaos.jpg) | ![Scan and label](docs/comic-02-scan-labels.jpg) |

| Knowledge graph | Safe cleanup |
|---|---|
| ![Knowledge graph](docs/comic-03-knowledge-map.jpg) | ![Safe cleanup](docs/comic-04-safe-cleanup.jpg) |

## Safe Troubleshooting Workflow

```bash
skm doctor
skm scan
skm scan --export json --output skm-scan.json --anonymize
skm
skm risks
skm report --format html --output skm-report.html
skm report --format html --output skm-report.html --anonymize
skm dupes
skm audit
skm list --mcp
skm sessions
skm sessions --clean --days 30 --keep 3 --dry-run
```

Start with read-only commands. Refresh facts first, then inspect health, risks, duplicates, usage, MCP servers, and session logs. Use anonymized exports when sharing data with others, and use dry-run before any cleanup.

## Safety Boundaries

Most commands are read-only for Claude Code, Codex, Cursor, and Gemini data. Some commands may update skm's own cache under `~/.skill-manager`, but they do not modify your AIDE configs, skills, MCP servers, or session logs. The explicit `skm setup` command and source install script are exceptions: they install the bundled bridge skill into supported user skill directories.

The security audit is static and conservative: it reads `SKILL.md`, directory metadata, and non-`env` MCP config fields only. It never executes a skill or MCP server, and suspicious command evidence is redacted before display.

Inside the CLI, only four actions can modify AIDE files:

| Action | What changes | Safeguards |
|---|---|---|
| `setup` | Installs `skill-navigator` into user skill directories | Explicit command; existing different directories are backed up before replacement; `--dry-run` available |
| `sessions --clean` | Deletes session log files | Requires retention policy; prints plan first; interactive confirmation or `--yes`; never deletes sessions active within 24 hours; aggregates usage stats before deletion |
| `disable/enable <skill>` | Renames skill directories | Reversible, no deletion; plugin skills are refused |
| `disable/enable --mcp` | Edits `~/.claude.json` / `config.toml` | Automatic backups; confirmation required; restore never overwrites manually recreated config |

More details: [docs/safety.md](docs/safety.md).

## Use Inside AIDE

`skm setup` installs `skill-navigator`:

```bash
~/.claude/skills/skill-navigator
~/.codex/skills/skill-navigator
```

This thin skill is the bridge between your AIDE coding assistant and `skill-manager`: when you ask "which skill should I use for this task?", the assistant should call the local `skm` command instead of manually scanning directories. Re-run `skm setup` after upgrading to refresh the bridge skill.

## Documentation

| Document | Content |
|---|---|
| [README.zh-CN.md](README.zh-CN.md) | Chinese README |
| [docs/usage.en.md](docs/usage.en.md) / [docs/usage.md](docs/usage.md) | Full command manual |
| [docs/recommend.en.md](docs/recommend.en.md) / [docs/recommend.md](docs/recommend.md) | Recommendation logic and advisor mode |
| [docs/graph.en.md](docs/graph.en.md) / [docs/graph.md](docs/graph.md) | Knowledge graph relationships and HTML interactions |
| [docs/report.en.md](docs/report.en.md) / [docs/report.md](docs/report.md) | HTML overview report |
| [docs/safety.en.md](docs/safety.en.md) / [docs/safety.md](docs/safety.md) | Safety boundaries and data notes |
| [docs/roadmap.en.md](docs/roadmap.en.md) / [docs/roadmap.md](docs/roadmap.md) | Roadmap |
| [CONTRIBUTING.en.md](CONTRIBUTING.en.md) / [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guide |
| [SECURITY.md](SECURITY.md) | Security policy and sensitive data reporting notes |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community behavior expectations |

## Language and Platform Support

**macOS / Windows:** validated on demand through the manually triggered GitHub Actions workflow. **Linux:** validated locally by the maintainer with the same read-only build/test commands.

```bash
npm run check
npm test
npm pack --dry-run --registry=https://registry.npmmirror.com
```

`skm help`, argument validation, `doctor`, `scan`, `setup`, `status`, `risks`, `report`, `list`, `search`, `recommend`, `ask`, `graph`, `dupes`, `audit`, `sessions`, `disable`, `enable`, and the local install script support English and Simplified Chinese output.

Use `--lang en`, `--lang zh-CN`, or `SKM_LANG=en`. JSON field names stay stable.

Manual validation entry: [GitHub Actions / macOS / Windows CI](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml).

## Roadmap

- More real-world `skm scan` / `skm recommend` samples
- Better clustering and layout for large knowledge graphs
- More AIDE adapters beyond the first conservative Cursor/Gemini directory scan
- Real per-server MCP tool schema measurement beyond the current static estimate

Full roadmap: [docs/roadmap.en.md](docs/roadmap.en.md).

## Community

If `skm` helped you understand your local skill setup, a GitHub Star helps more users find it. You can also:

- Share your `skm scan` result: <https://github.com/GrubbyLee/skill-manager/discussions/9>
- Discuss the roadmap: <https://github.com/GrubbyLee/skill-manager/discussions/8>
- Report issues or suggest features: <https://github.com/GrubbyLee/skill-manager/issues>

## License

[MIT](LICENSE)
