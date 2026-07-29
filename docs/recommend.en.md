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
- usage count and recency; among already relevant candidates, common categories and suites get a small personal-preference boost
- whether the skill is available in both Claude Code and Codex

Personal preference only applies after relevance matching. For example, if you often use a `baoyu-*` image suite, image tasks may boost that suite slightly; a meeting-note task will not recommend image skills just because they are frequent.

## Measurable Regression Benchmark

The repository includes a public, anonymized Chinese/English benchmark for detecting ranking regressions:

```bash
npm run benchmark:recommend
```

The current corpus contains 23 synthetic skills and 40 task descriptions, split evenly between Chinese and English. It covers format conversion, images, diagrams, slides, meetings, translation, code review, publishing, and other common workflows.

| Metric | Meaning |
|---|---|
| Top 1 | Cases where the first result is an expected candidate |
| Top 3 | Cases where an expected candidate appears in the first three results |
| MRR | Mean reciprocal rank of the first expected candidate; closer to 1 is better |
| Known-error rate | Cases where the first three results contain an explicitly forbidden candidate; lower is better |

The current fixed corpus reports 100% Top 1, 100% Top 3, 1.000 MRR, and a 0% known-error rate. This only means the current version passes these 40 regression cases. **It is not a claim of 100% accuracy for every catalog or task.**

Automated tests use defensive regression thresholds: at least 95% overall Top 1, 98% Top 3, 0.97 MRR, a zero known-error rate, and at least 90% Top 1 for each language. Run the full gate with:

```bash
npm test
```

Benchmark boundaries:

- It uses only fixed anonymous repository data; it does not read the local `catalog.json` or session logs.
- It detects ranking regressions but does not replace validation against real user catalogs.
- New cases must remove usernames, absolute paths, private skill names, and other sensitive data.
- Real-world feedback remains the primary source for broader wording, skill types, and known-error cases.

## Options

| Option | Purpose |
|---|---|
| `--top <N>` | Return up to N recommendations, max 20 |
| `--tool claude\|codex\|cursor\|gemini` | Restrict to one tool |
| `--category <keyword>` | Restrict by category |
| `--why` | Show score, matched terms, and reasons |
| `--advisor codex\|claude` | Explicitly call a local AIDE CLI for enhanced ranking |
| `--json` | Structured output |

## Advisor Mode

Advisor mode only runs when `--advisor` is explicitly passed. It uses Node.js built-in `child_process` to call the local `codex` or `claude` CLI.

It sends a relevance-first compact candidate list: skill name, category, tool source, description, usage count, local score, and local reasons.

Candidate compression prioritizes top local matches, category-relevant entries, and skills with real usage history. It does not hand the whole catalog to the advisor.

It does not send:

- real skill paths
- Claude/Codex config paths
- MCP `env` values
- API keys, passwords, private keys
- session log bodies

If the local CLI is missing, logged out, offline, or times out, skm falls back to local ranking.
