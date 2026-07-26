# Security Policy

`skill-manager` inspects local Claude Code / Codex skill and MCP metadata. Most commands are read-only for AIDE data, but security reports are still welcome.

## Supported Versions

The `main` branch and latest GitHub Release are supported.

## Reporting a Vulnerability

Please open a private security advisory or contact the maintainer through GitHub:

<https://github.com/GrubbyLee/skill-manager/security/advisories/new>

If the issue is not sensitive, you can open a regular issue:

<https://github.com/GrubbyLee/skill-manager/issues>

## Sensitive Data

Do not include API keys, passwords, cookies, tokens, private keys, full session logs, or private filesystem paths in public issues or discussions.

For MCP-related reports, describe the transport and command shape, but do not paste environment variable values.

## Project Boundaries

- `skm scan`, `skm status`, `skm risks`, `skm report`, `skm graph`, `skm list`, `skm search`, `skm recommend`, `skm ask`, `skm dupes`, and `skm audit` are designed to be read-only for Claude Code / Codex data.
- `sessions --clean`, `disable`, and `enable` are the only file-modifying command families.
- File-modifying commands must keep confirmation, backup, and safety-window safeguards.
