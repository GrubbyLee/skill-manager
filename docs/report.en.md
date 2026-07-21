# HTML Overview Report

`skm report` puts health, risks, usage audit, session logs, and knowledge graph summary on one page.

## Quick Start

```bash
skm report
skm report --format html --output skm-report.html
skm report --json
```

The HTML report is a zero-dependency single file that opens directly in a browser.

## What It Contains

- health score, skill count, MCP count
- never-used skills, duplicate physical installs, session log size, reclaim estimate
- risk items
- usage Top 10
- resident context cost Top 10
- largest session-log workspaces
- knowledge graph edge summary
- next-step commands

## Safety

`report` is read-only for AIDE data. It may update skm's own `~/.skill-manager/usage-cache.json` and session index cache, but it does not modify Claude/Codex configs, skills, MCP servers, or session logs.
