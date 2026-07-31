<p align="center">
  <img src="../../docs/logo.svg" alt="skill-manager" width="640">
</p>

# skill-navigator

[简体中文](README.zh-CN.md) | English

`skill-navigator` is the bundled bridge skill for [skill-manager](https://github.com/GrubbyLee/skill-manager). It lets Claude Code and Codex ask the local `skm` CLI which skills and MCP servers are installed, which skill fits a task, which items are duplicated or unused, and how the local skill graph is connected.

It is intentionally thin: the skill does not scan directories by itself. It calls `skm`, so recommendations and audits come from the user's real local catalog.

## Install

```bash
npm i -g aide-skill-manager
skm setup
skm scan
```

`skm setup` installs this bridge skill into:

```text
~/.claude/skills/skill-navigator
~/.codex/skills/skill-navigator
```

For source installs:

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
node scripts/install.mjs
skm scan
```

## What It Handles

| User question | Command the skill should use |
|---|---|
| What skills do I have? | `skm list` |
| Which skill should I use for this task? | `skm recommend "<task>" --json` |
| Which skills are duplicated? | `skm dupes` |
| Which skills are unused or risky? | `skm audit` / `skm risks` |
| Are GitHub/Gitee skills current? | `skm outdated`; use `skm outdated --online` only when explicit upstream checking is needed |
| Can you draw the skill knowledge graph? | `skm graph --format html --output skill-graph.html` |
| Why is startup/context heavy? | `skm list --mcp` / `skm audit` |
| Did my catalog get stale? | `skm scan` |

## Example Prompts

```text
Which skill should I use to convert a web page to Markdown?
```

```text
I want to create a product slide deck. Which installed skill fits best?
```

```text
Which skills are duplicated or have never been used?
```

```text
Are my GitHub-sourced skills still up to date?
```

```text
Generate a local HTML knowledge graph for my installed skills.
```

## Safety

Most `skm` commands are read-only for AIDE data. The bridge normally uses read-only commands such as `list`, `search`, `recommend`, `audit`, `risks`, `report`, and `graph`.

Write operations remain explicit:

| Operation | Guardrail |
|---|---|
| `skm setup` | Installs this bridge skill; backs up different existing target directories |
| `skm sessions --clean` | Requires a retention policy and confirmation |
| `skm disable` / `skm enable` | Soft-disables or restores skills/MCP servers with backups where config files change |

## Hub Publishing and Updates

The source of truth is this GitHub directory:

<https://github.com/GrubbyLee/skill-manager/tree/main/integrations/skill-navigator>

When submitting to a skill hub, prefer a GitHub repository or source URL instead of uploading a detached copy. Future updates are then handled by updating GitHub and publishing a new `aide-skill-manager` npm version.

If a hub only accepts pasted content or uploaded files, treat that listing as a mirror and update it manually after releases.

## Metadata

- Package: `aide-skill-manager`
- CLI command: `skm`
- Main project: <https://github.com/GrubbyLee/skill-manager>
- License: MIT
- Compatible AIDE targets: Claude Code, Codex CLI
- Scanned ecosystems: Claude Code, Codex CLI, Cursor, Gemini, MCP
