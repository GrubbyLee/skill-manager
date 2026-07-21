# Contributing

Thank you for improving skill-manager. The project is built for heavy Claude Code / Codex skill and MCP users who want a clear, safe, local inventory of their AIDE tool setup.

## Local Development

```bash
git clone https://github.com/GrubbyLee/skill-manager.git
cd skill-manager
npm install --ignore-scripts
node scripts/install.mjs --dry-run
npm run check
npm test
```

This project has zero third-party runtime dependencies. `package.json` should not contain a `dependencies` section.

## Before Submitting

```bash
npm run check
npm test
npm pack --dry-run --registry=https://registry.npmmirror.com
```

Linux can be validated locally with the same commands. GitHub Actions validates macOS and Windows.

## Good Contribution Areas

- New skill classification rules or misclassification fixes
- New AIDE adapters, such as Cursor or Gemini CLI
- Better task-intent recognition for `recommend`
- Graph relationship detection, layout, and export style improvements
- Additional `doctor` / `risks` diagnostics
- Documentation, screenshots, and real-world usage examples

See [docs/roadmap.en.md](docs/roadmap.en.md) for the current roadmap.

## Code Conventions

- Node.js >= 18, ES Modules
- User-facing CLI output should support English and Simplified Chinese
- Use the project date helpers for user-facing time display
- Validate arguments early and fail with clear errors
- Do not read or record API keys, passwords, private keys, or secret files
- MCP scanning must not read `env` values

## Write Operations

Changes touching `sessions --clean`, `disable`, or `enable` need extra care:

- Keep confirmation prompts
- Keep backup behavior
- Keep the 24-hour safety window for session cleanup
- Keep dry-run behavior
- Add or update tests

## Pull Requests

Please explain:

- What changed
- Why it changed
- How it was validated
- Whether it affects write-operation safety boundaries

For larger feature ideas, opening an Issue first is usually the best way to clarify scope and safety boundaries.
