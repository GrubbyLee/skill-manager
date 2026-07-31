# HTML Overview Report

`skm report` puts health, risks, usage audit, session logs, and knowledge graph summary on one page.

## Quick Start

```bash
skm report
skm report --format html --output skm-report.html
skm report --format html --output skm-report.html --anonymize
skm report --json
```

The HTML report is a zero-dependency single file that opens directly in a browser.

## What It Contains

- health score, skill count, MCP count
- never-used skills, duplicate physical installs, session log size, reclaim estimate
- risk items
- usage Top 10
- resident context cost Top 10
- estimated MCP schema cost Top 10
- largest session-log workspaces
- knowledge graph edge summary
- next-step commands

## Anonymized Reports

Before sharing a report, use:

```bash
skm report --format html --output skm-report.html --anonymize
```

Anonymization redacts paths, real paths, config file locations, scan directories, workspaces, MCP `command` values, and upstream `source` / `repository` / `homepage` / git remote values. It keeps categories, counts, relationships, risk levels, and token estimates so others can still reason about the report.

## MCP Schema Estimate

The report includes a static per-server MCP schema context estimate. This version does not launch MCP servers and does not read `env` values. It estimates from server name, transport, and command metadata only, which is enough to flag servers that may have high resident context cost.

## Safety

`report` is read-only for AIDE data. It may update skm's own `~/.skill-manager/usage-cache.json` and session index cache, but it does not modify Claude/Codex/Cursor/Gemini configs, skills, MCP servers, or session logs.
