<p align="center">
  <img src="../../docs/logo.svg" alt="skill-manager" width="640">
</p>

# skill-navigator

[简体中文](README.zh-CN.md) | English

`skill-navigator` is the bundled bridge skill for [skill-manager](https://github.com/GrubbyLee/skill-manager). It answers one question: **which already-installed local Agent Skill should handle this task?**

It is intentionally thin: the skill does not perform the task itself and does not scan directories by hand. It calls `skm ask` / `skm recommend` against the user's real local skill catalog, then explains the best choices.

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

## Cursor / Gemini manual install

This skill is a plain instruction skill and does not depend on platform-specific features. You can also drop a copy into Cursor or Gemini skill directories manually.

Example:

```bash
# Cursor
cp -R integrations/skill-navigator ~/.cursor/skills/skill-navigator

# Gemini CLI (use your actual Gemini skill path)
cp -R integrations/skill-navigator ~/.gemini/skills/skill-navigator
```

After manual install, `skm` must still be available on PATH and `skm scan` must have been run at least once.

## What It Handles

| User question | Command the skill should use |
|---|---|
| Which skill should I use for this task? | `skm ask "<task>" --json` (primary entry) |
| I want more candidates or a comparison | `skm recommend "<task>" --top 5 --json` |
| I already have a clear keyword | `skm search "<keyword>" --json` |
| Only show skills for one tool | Add `--tool claude|codex|cursor|gemini` |
| The catalog may be stale after installing/removing skills | Ask the user to run `skm scan`, then retry recommendation |

## Output principles

- Lead with one top pick, then list 1–3 alternatives.
- For each candidate, explain the name, why it fits, and which tools it is available on.
- Make it clear this is a recommendation from **locally installed skills**, not a web search.
- Do not perform the task on behalf of the user. After recommending, tell the user to switch to or call the suggested skill.

## Example Prompts

```text
Which skill should I use to convert a web page to Markdown?
```

```text
I want to create a product slide deck. Which installed skill fits best?
```

```text
Which installed skills work on the Codex side for generating Xiaohongshu images?
```

```text
I just installed a new skill. Why is it not in the recommendations?
```

## Safety

The bridge normally uses read-only recommendation commands such as `ask`, `recommend`, and `search`.

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
- Compatible AIDE targets: Claude Code, Codex CLI, Cursor (manual), Gemini (manual)
- Primary purpose: recommend which installed skill should handle a user task
