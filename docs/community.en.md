# Community Materials

Use this page for project posts, launch notes, and user invitations.

## One-Liner

skill-manager is a Claude Code / Codex skill and MCP manager: scan, recommend, deduplicate, audit, report risks, and generate knowledge graphs.

## Short Intro

If you install many Claude Code or Codex skills, it becomes hard to know what exists, which ones are duplicates, which ones were never used, which skill fits a task, and whether MCP servers are consuming context.

`skm` turns those questions into commands:

```bash
skm scan
skm
skm ask "convert a web page to Markdown"
skm graph --format html --output skill-graph.html
```

It is read-only by default, has zero third-party npm dependencies, and requires Node.js >= 18.

GitHub: <https://github.com/GrubbyLee/skill-manager>

## Post Titles

- I installed many AIDE skills, so I built a manager for Claude Code and Codex
- How do you know which Claude Code / Codex skill to use?
- A knowledge graph for your local Claude Code / Codex skills and MCP servers
- skill-manager: scan, recommend, deduplicate, and audit your AIDE skills

## Launch Checklist

- README first screen can be tried in 30 seconds
- screenshots and graph examples are visible
- Release exists
- Discussions has a place to share `skm scan` output
- Issues ask for `skm doctor` / `skm scan`
- safety boundaries are explicit
