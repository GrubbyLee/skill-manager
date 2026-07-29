# Skill Knowledge Graph

`skm graph` turns installed skills, MCP servers, categories, families, and platform relationships into a knowledge graph.

## Quick Start

```bash
skm graph
skm graph --format html --output skill-graph.html
skm graph --format json --output skill-graph.json
skm graph --format mermaid --output skill-graph.md
```

The HTML graph is a zero-dependency single file with inline SVG, CSS, and JavaScript.

## Node Types

| Node | Meaning |
|---|---|
| `skill` | Merged skill capability with category, tool source, usage, recency, and context estimate |
| `mcp` | MCP server with tool source, transport, and usage |
| `category` | Category cluster |
| `family` | Prefix family, such as `baoyu-*`, `lark-*`, `gsap-*` |
| `platform` | Shared platform, such as GitHub, Lark, WeChat, X / Twitter, OpenAI |

## Relationship Types

| Relationship | Meaning |
|---|---|
| same family | Same directory prefix; usually same author, toolkit, or suite |
| same category | Same classification category; related use case |
| duplicate | Identical `SKILL.md` content hash across install records |
| strong alternative | Similar name/description in the same category but different family, with stronger similarity evidence |
| weak alternative | Similar name/description in the same category but lower confidence than strong alternative |
| workflow | One skill output can feed another skill input |
| upstream/downstream | One skill appears to collect/read/extract/generate input while another publishes/writes/uploads/renders output |
| shared I/O format | Skills share formats such as Markdown, HTML, PDF, JSON, CSV, PNG, or MP4 |
| reverse conversion | Opposite conversion directions, such as Markdown to HTML and HTML to Markdown |
| shared platform | Same external platform keyword |
| same-platform action | Skills target the same platform but perform different actions, such as search, publish, summarize, or download |
| uses MCP | Skill description mentions MCP and a specific MCP server |

## Graph Summaries

JSON and HTML graph output includes summary entries:

- densest suite: the family with the most same-family relationships
- duplicate core: areas with identical content or duplicate physical installs
- platform ecosystem: capability groups around GitHub, Lark, WeChat, Notion, and similar platforms
- potential workflow: combinations inferred from workflow, upstream/downstream, and shared I/O-format edges

## HTML Interactions

- relationship filters affect both edges and nodes
- hover over relationship names for detailed explanations
- search focuses matching nodes and one-hop relationships
- important-node mode keeps used, duplicated, or highly connected skills
- hide never-used skills to reduce noise
- labels can be toggled off
- nodes are draggable
- zoom in, zoom out, and fit view help with large graphs
- reset layout restores initial positions

## Reading Tips

- For suites, keep only same family.
- For workflows, enable workflow, upstream/downstream, shared I/O format, and reverse conversion.
- For platform ecosystems, enable shared platform and search for `github`, `lark`, `notion`, or `wechat`.
- If the graph is dense, disable same category/shared platform and enable important-node mode.
