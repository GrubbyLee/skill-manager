# Security Policy

`skill-manager` inspects local skill packages and MCP metadata across supported AIDE tools. Most commands are read-only for AIDE data, while explicit lifecycle commands can stage, install, update, back up, or restore skill directories. Security reports are welcome for either surface.

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

- Inventory, reporting, recommendation, graph, audit, `outdated`, and lifecycle verification commands are designed to be read-only for AIDE data, though they may refresh skm-owned files under `~/.skill-manager`.
- Explicit `setup`, `install`, `update`, `rollback`, `profile apply`, `state set`, `sessions --clean`, `disable`, and `enable` commands can modify supported AIDE files.
- Skill install/update must preserve staging validation, complete-package static audit, the high-risk policy gate, and confirmation. Update/rollback must preserve instance-scoped backups and atomic replacement with restoration on failure.
- Repository packages are copied but never executed by skm. MCP `env` values and secrets are outside the intended collection surface.
