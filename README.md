# skill-manager (skm)

English | [简体中文](README.zh-CN.md)

[![macOS / Windows CI](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-3c873a)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-2f6f4e)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> A zero-dependency CLI to scan, recommend, deduplicate, audit, and visualize Claude Code / Codex skills and MCP servers.

When you keep adding skills to Claude Code or Codex, the local setup can become hard to reason about: duplicated skills, shared symlinks, unused tools, unclear names, and MCP servers that keep consuming context. `skm` turns that local toolbox into something you can inspect, search, compare, and clean up safely.

![skm demo](docs/demo.png)

## 30-Second Start

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs

skm scan
skm
skm ask "convert a web page to Markdown"
skm graph --format html --output skill-graph.html
```

No npm package install is advertised yet. The package name `aide-skill-manager` is reserved, but the current recommended installation path is git clone.

## What It Solves

| Question | Command | What you get |
|---|---|---|
| How many skills and MCP servers are installed? | `skm scan` | Counts, categories, install sources, context estimate |
| Is my local AIDE setup healthy? | `skm` | Health score, zombie skills, duplicate installs, idle MCP, session size |
| Which skill should I use for this task? | `skm ask "task"` | Best match, reasons, alternatives |
| Which skills are duplicated? | `skm dupes` | Same name, same content, same category, text similarity |
| Which skills were never really used? | `skm audit` | Real usage frequency from Claude Code / Codex sessions |
| How are skills related? | `skm graph --format html` | Filterable, draggable, single-file knowledge graph |
| What are the risky items? | `skm risks` | Prioritized risk list and conservative suggestions |
| Where did my session logs grow? | `skm sessions` | Workspace-level session log size and dry-run cleanup plan |

## Command Cheatsheet

| Command | Purpose |
|---|---|
| `skm` / `skm status` | One-screen health overview |
| `skm doctor` | Read-only environment diagnostics |
| `skm risks` | Risk report without changing AIDE data |
| `skm scan` | Scan skills and MCP servers, rebuild catalog |
| `skm list` / `skm list --mcp` | List skills or MCP servers |
| `skm search <keyword>` | Search by name, category, and description |
| `skm recommend <task>` | Ranked skill recommendations |
| `skm ask <task>` | Q&A-style skill recommendation |
| `skm graph` | Export the skill knowledge graph |
| `skm dupes` | Detect duplicates and similar skills |
| `skm audit` | Audit real usage frequency |
| `skm sessions` | Inspect session log distribution |
| `skm sessions --clean` | Clean session logs with confirmation |
| `skm disable` / `skm enable` | Soft-disable or restore skills / MCP servers |

The detailed command manual is currently in Chinese: [docs/usage.md](docs/usage.md). English documentation is on the roadmap.

## Skill Recommendation

If you know what you want to do but do not remember which skill fits:

```bash
skm ask "convert a web page to Markdown"
skm recommend "create image cards for Xiaohongshu" --top 5
skm recommend "markdown to html" --why
```

By default, recommendations run locally. No external model is called, and no directory information is uploaded. The ranking combines skill name, category, description, task intent, conversion direction, usage history, recency, and whether the skill is available in both Claude Code and Codex.

You can explicitly ask a local AIDE CLI to help judge the short candidate list:

```bash
skm recommend "create a knowledge graph" --advisor codex --why
skm recommend "summarize meeting notes" --advisor claude
```

Advisor mode sends only a compact candidate list. It does not send real skill paths, config paths, MCP `env` values, API keys, passwords, private keys, or session log bodies.

## Knowledge Graph

```bash
skm graph --format html --output skill-graph.html
```

The HTML graph is a zero-dependency single file. Open it in a browser and filter relationships from the left panel; the graph only shows nodes involved in the selected relationships. Nodes are draggable, which helps when you have many installed skills.

![skm skill knowledge graph](docs/graphic.png)

Current relationship types include same family, same category, duplicate, alternative, workflow, reverse conversion, shared platform, and uses MCP. Details are in [docs/graph.md](docs/graph.md).

## Safe Troubleshooting Workflow

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

Start with read-only commands. Refresh facts first, then inspect health, risks, duplicates, usage, MCP servers, and session logs. Use dry-run before any cleanup.

## Safety Boundaries

Most commands are read-only for Claude Code and Codex data. Some commands may update skm's own cache under `~/.skill-manager`, but they do not modify your Claude/Codex configs, skills, MCP servers, or session logs.

Only three actions can modify files:

| Action | What changes | Safeguards |
|---|---|---|
| `sessions --clean` | Deletes session log files | Requires retention policy; prints plan first; interactive confirmation or `--yes`; never deletes sessions active within 24 hours; aggregates usage stats before deletion |
| `disable/enable <skill>` | Renames skill directories | Reversible, no deletion; plugin skills are refused |
| `disable/enable --mcp` | Edits `~/.claude.json` / `config.toml` | Automatic backups; confirmation required; restore never overwrites manually recreated config |

More details: [docs/safety.md](docs/safety.md).

## Use Inside AIDE

Install the thin navigator skill into Claude Code or Codex, then ask your coding assistant which skill to use for a task:

```bash
cp -r integrations/skill-navigator ~/.claude/skills/
cp -r integrations/skill-navigator ~/.codex/skills/
```

## Visual Story

| Too many tools | Scan and label |
|---|---|
| ![Too many tools](docs/comic-01-tool-chaos.jpg) | ![Scan and label](docs/comic-02-scan-labels.jpg) |

| Knowledge graph | Safe cleanup |
|---|---|
| ![Knowledge graph](docs/comic-03-knowledge-map.jpg) | ![Safe cleanup](docs/comic-04-safe-cleanup.jpg) |

## Features

- Scans Claude Code and Codex CLI skills / MCP servers
- Detects shared symlinks, duplicate physical copies, and same-content copies
- Classifies skills with local rules
- Recommends skills from natural-language task descriptions
- Audits real usage from session logs
- Finds zombie skills and idle Claude-side MCP servers
- Exports JSON, Mermaid, and single-file HTML knowledge graphs
- Uses zero third-party npm dependencies
- Runs on Node.js >= 18

## Documentation

| Document | Content |
|---|---|
| [README.zh-CN.md](README.zh-CN.md) | Chinese README |
| [docs/usage.md](docs/usage.md) | Full command manual, currently Chinese |
| [docs/recommend.md](docs/recommend.md) | Recommendation logic and advisor mode, currently Chinese |
| [docs/graph.md](docs/graph.md) | Knowledge graph relationships and HTML interactions, currently Chinese |
| [docs/safety.md](docs/safety.md) | Safety boundaries and data notes, currently Chinese |
| [docs/roadmap.md](docs/roadmap.md) | Roadmap, currently Chinese |
| [docs/community.md](docs/community.md) | Community post templates, currently Chinese |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guide, currently Chinese |

## Cross-Platform Validation

GitHub Actions validates macOS and Windows. Linux is validated locally by the maintainer with the same read-only build/test commands.

```bash
npm run check
npm test
npm pack --dry-run --registry=https://registry.npmmirror.com
```

CI entry: [GitHub Actions / macOS / Windows CI](https://github.com/GrubbyLee/skill-manager/actions/workflows/ci.yml).

## Roadmap

- English CLI output and full English documentation
- More real-world `skm scan` / `skm recommend` samples
- HTML overview report
- Better clustering and layout for large knowledge graphs
- More AIDE adapters, such as Cursor and Gemini CLI
- Per-server MCP tool schema token measurement

Full roadmap: [docs/roadmap.md](docs/roadmap.md).

## Community

If `skm` helped you understand your local skill setup, a GitHub Star helps more users find it. You can also:

- Share your `skm scan` result: <https://github.com/GrubbyLee/skill-manager/discussions/9>
- Discuss the roadmap: <https://github.com/GrubbyLee/skill-manager/discussions/8>
- Report issues or suggest features: <https://github.com/GrubbyLee/skill-manager/issues>

## License

[MIT](LICENSE)
