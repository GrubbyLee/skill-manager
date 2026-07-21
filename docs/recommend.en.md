# Skill Recommendation

`skm recommend` and `skm ask` answer: which installed skill should I use for this task?

## Quick Start

```bash
skm ask "convert a web page to markdown"
skm recommend "create image cards" --top 5
skm recommend "markdown to html" --why
skm recommend "create a knowledge graph" --advisor codex --why
```

`ask` is concise. `recommend` is better when you want to compare candidates.

## Local Ranking

By default, recommendation is fully local. It does not call an external model and does not upload your catalog.

Ranking uses:

- name, frontmatter `name`, category, and description
- Chinese/English synonyms
- task intent, such as image, graph, slides, meeting notes, writing, translation
- conversion direction, such as `markdown to html` or `html to markdown`
- usage count and recency
- whether the skill is available in both Claude Code and Codex

## Options

| Option | Purpose |
|---|---|
| `--top <N>` | Return up to N recommendations, max 20 |
| `--tool claude\|codex` | Restrict to one tool |
| `--category <keyword>` | Restrict by category |
| `--why` | Show score, matched terms, and reasons |
| `--advisor codex\|claude` | Explicitly call a local AIDE CLI for enhanced ranking |
| `--json` | Structured output |

## Advisor Mode

Advisor mode only runs when `--advisor` is explicitly passed. It uses Node.js built-in `child_process` to call the local `codex` or `claude` CLI.

It sends a compact candidate list: skill name, category, tool source, description, usage count, local score, and local reasons.

It does not send:

- real skill paths
- Claude/Codex config paths
- MCP `env` values
- API keys, passwords, private keys
- session log bodies

If the local CLI is missing, logged out, offline, or times out, skm falls back to local ranking.
