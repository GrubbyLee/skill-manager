# Roadmap

skill-manager aims to become the most useful open-source governance tool for AIDE skills: understand the local inventory first, then recommend, deduplicate, audit, visualize, and clean safely.

## Current Stage

`v0.1.x` focuses on the core loop:

- scan Claude Code / Codex skills and MCP servers
- classify, search, recommend, and visualize
- detect duplicates, audit usage, and report risks
- inspect and safely plan session log cleanup
- export a one-page HTML overview report
- export anonymized scan/report data and estimate MCP schema context cost
- keep zero third-party dependencies with macOS / Windows CI validation
- provide bilingual README/docs, issue templates, Discussions, and releases

## Priorities

| Priority | Area | Value | Status |
|---|---|---|---|
| P0 | Real user samples | Calibrate classification, recommendation, and graph relationships | In progress |
| P0 | Recommendation quality | Make "which skill should I use?" the default entry point | In progress |
| P1 | HTML overview report | Shareable local health report | Implemented |
| P1 | Graph layout | Clearer large graphs and clusters | In progress |
| P1 | Anonymized export | Share scan/report output without local paths, config locations, or MCP commands | Implemented |
| P1 | Install experience | Keep git clone install smooth before npm release | First pass implemented |
| P1 | English docs and CLI i18n | Serve global GitHub users while keeping Chinese docs; core CLI flows and detailed docs support English | Implemented |
| P2 | More AIDE adapters | Cursor, Gemini CLI, and other tools | First conservative directory-scan pass implemented |
| P2 | MCP token estimate | Per-server MCP tool schema context estimate | Static estimate implemented |

## Recommendation

- Implemented: a 40-case anonymous Chinese/English corpus with Top 1, Top 3, MRR, and known-error metrics
- Implemented: automated recommendation thresholds that prevent silent ranking regressions
- Implemented: stronger bilingual intents, non-adjacent action matching, and conversion direction handling
- Implemented: learn personal preferences from `skm audit` without letting unrelated frequent skills dominate
- Implemented: improve candidate compression and fallback messages for `--advisor codex|claude`
- In progress: collect anonymized real-user samples to broaden wording, skill types, and known-error cases

## Internationalization

- Implemented: bilingual README, detailed English docs, `--lang` / `SKM_LANG`, help, validation errors, all primary commands, and the install script
- Next: refine English wording and category localization from real user feedback
- Constraints: no third-party dependencies; stable JSON field names; Simplified Chinese docs remain available

## Knowledge Graph

- Implemented: lightweight collision avoidance, zooming, and fit-to-view for large graphs
- Implemented: upstream/downstream, shared input/output formats, same-platform actions, strong/weak alternatives
- Implemented: summaries for densest suites, duplicate cores, platform ecosystems, and potential workflows
- Implemented: a one-page HTML report combining graph, risk, and recommendation summaries

## Adapters and MCP

- Implemented: Claude Code / Codex skill and MCP scanning
- Implemented: Cursor / Gemini common skill-directory scanning without reading sensitive caches or launching external tools
- Implemented: static MCP schema context estimates for risk reports and HTML reports
- Next: collect more AIDE directory-layout samples
- Next: explore more accurate MCP schema measurement without reading secrets or starting unsafe processes

## Community

The most useful feedback:

- share the category distribution from `skm scan`
- report misclassified or missing skills with their names and descriptions
- check whether `skm ask "<task>"` recommendations feel right
- share graph screenshots and identify useful or noisy relationships
- provide directory and MCP configuration samples from additional AIDE tools

Links:

- Discussions: <https://github.com/GrubbyLee/skill-manager/discussions>
- Share scan results: <https://github.com/GrubbyLee/skill-manager/discussions/2>
- Issues: <https://github.com/GrubbyLee/skill-manager/issues>
