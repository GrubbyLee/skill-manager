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
| `category` | A concrete category and its member skills |
| `family` | Suite inferred from a directory prefix, such as `baoyu-*`, `lark-*`, or `gsap-*`; this does not prove common authorship or repository origin |
| `platform` | A concrete platform such as GitHub, Lark, WeChat, X / Twitter, or OpenAI; each platform has a separate node |

## Relationship Types

| Relationship | Meaning |
|---|---|
| suite membership | Skill-to-suite membership inferred from a directory prefix; it does not assert common authorship or repository origin |
| category membership | Skill-to-category membership produced by classification rules; it does not imply dependencies between member skills |
| duplicate | Identical `SKILL.md` content hash across install records |
| strong alternative | Similar name/description in the same category but different family, with stronger similarity evidence |
| weak alternative | Similar name/description in the same category but lower confidence than strong alternative |
| workflow | One skill output can feed another skill input |
| upstream/downstream | One skill appears to collect/read/extract/generate input while another publishes/writes/uploads/renders output |
| shared I/O format | Skills share formats such as Markdown, HTML, PDF, JSON, CSV, PNG, or MP4 |
| reverse conversion | Opposite conversion directions, such as Markdown to HTML and HTML to Markdown |
| platform membership | A name or description matches one concrete external platform node |
| platform role overlap | Keywords suggest different roles in one platform, such as search, publish, summarize, or download; review this inferred signal manually |
| uses MCP | Skill description mentions MCP and a specific MCP server |

## Graph Summaries

JSON and HTML graph output includes summary entries:

- densest suite: the suite with the most membership relationships
- duplicate core: areas with identical content or duplicate physical installs
- platform ecosystem: capability groups around GitHub, Lark, WeChat, Notion, and similar platforms
- potential workflow: combinations inferred from workflow, upstream/downstream, and shared I/O-format edges

## HTML Interactions

- relationship filters affect both edges and nodes
- hover over relationship names for detailed explanations
- search focuses matching nodes and one-hop relationships
- node limit keeps high-signal nodes first, ranked by usage, relationship count, and duplicate-install signals; search temporarily bypasses the limit so exact matches are not hidden
- important-node mode keeps used, duplicated, or highly connected skills
- hide never-used skills to reduce noise
- labels can be toggled off
- nodes are draggable
- zoom in, zoom out, and fit view help with large graphs
- reset layout restores initial positions

## Reading Tips

- For suites, keep only suite membership.
- For workflows, enable workflow, upstream/downstream, shared I/O format, and reverse conversion.
- For platform ecosystems, enable platform membership and search for `github`, `lark`, `notion`, or `wechat`.
- If the graph is dense, set the node limit to High-signal top 60/100, disable category/platform membership, enable important-node mode or hide never-used skills, then fit view.

The `skm web` dashboard adds a **Focus scope** selector for concrete suites, platforms, and categories. Selecting `baoyu-*` isolates that suite; selecting `GitHub` isolates GitHub members and their currently enabled internal relationships. Relationship evidence is marked as explicit, structural, or inferred so directory-prefix and keyword signals are not mistaken for verified facts.
