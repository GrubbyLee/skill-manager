# Roadmap

skill-manager aims to become the most useful open-source governance tool for AIDE skills: understand the local inventory first, then recommend, deduplicate, audit, visualize, and clean safely.

## Current Stage

`v0.1.x` focuses on the core loop:

- scan Claude Code / Codex skills and MCP servers
- classify, search, recommend, and visualize
- detect duplicates, audit usage, and report risks
- inspect and safely plan session log cleanup
- zero third-party dependencies
- macOS / Windows CI, Linux local validation
- English and Simplified Chinese README and CLI output

## Priorities

| Priority | Area | Value | Status |
|---|---|---|---|
| P0 | Real user samples | Calibrate classification, recommendation, and graph relationships | In progress |
| P0 | Recommendation quality | Make "which skill should I use?" the default entry point | In progress |
| P1 | HTML overview report | Shareable local health report | Implemented |
| P1 | Graph layout | Clearer large graphs and clusters | In progress |
| P1 | Install experience | Keep git clone install smooth before npm release | In progress |
| P1 | English docs and CLI i18n | Serve global GitHub users while keeping Chinese docs | In progress |
| P2 | More AIDE adapters | Cursor, Gemini CLI, and other tools | Planned |
| P2 | MCP token measurement | Per-server MCP tool schema token estimate | Planned |

## Next Work

- collect more real-world recommendation samples
- improve large-graph clustering and summaries
- add more regression samples for recommendation
- translate remaining contribution docs
- prepare npm publishing once the release environment is available
