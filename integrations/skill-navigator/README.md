<p align="center">
  <img src="../../docs/logo.svg" alt="skill-manager" width="640">
</p>

# skill-navigator

[简体中文](README.zh-CN.md) | English

`skill-navigator` is the bundled bridge skill for [skill-manager](https://github.com/GrubbyLee/skill-manager). It answers one question: **which already-installed local Agent Skill should handle this task?**

It is intentionally thin: the skill does not perform the task itself and does not scan directories by hand. It calls `skm recommend` against the user's real local skill catalog, then explains the best 1-3 installed skill choices.

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
| Which skill should I use for this task? | `skm recommend "<task>" --json` |
| The recommendation looks incomplete | `skm search "<keyword>" --json` |
| The catalog may be stale after installing/removing skills | Ask the user to run `skm scan`, then retry `skm recommend` |

## Example Prompts

```text
Which skill should I use to convert a web page to Markdown?
```

```text
I want to create a product slide deck. Which installed skill fits best?
```

```text
I need to publish a Markdown article to WeChat. Which installed skill should I use?
```

## Safety

The bridge normally uses read-only recommendation commands such as `recommend` and `search`.

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
- Primary purpose: recommend which installed skill should handle a user task
