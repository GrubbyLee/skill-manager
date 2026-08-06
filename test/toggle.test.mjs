import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('toggle：disable --dry-run 不重命名 skill 目录', () => {
  const home = makeHome('skm-toggle-skill-');
  const skillDir = path.join(home, '.claude', 'skills', 'alpha');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: alpha\ndescription: alpha\n---\n');

  const r = run(['disable', 'alpha', '--dry-run', '--lang', 'en'], home);

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] would disable claude\/user\/alpha/);
  assert.match(r.stdout, /\[dry-run\] no changes made\./);
  assert.equal(fs.existsSync(skillDir), true);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', '_disabled-alpha')), false);
});

test('toggle：MCP --dry-run 不写配置、不创建备份', () => {
  const home = makeHome('skm-toggle-mcp-');
  const claudeFile = path.join(home, '.claude.json');
  const codexFile = path.join(home, '.codex', 'config.toml');
  const claudeText = JSON.stringify({ mcpServers: { drawio: { command: 'drawio-mcp' } } }, null, 2);
  const codexText = '[mcp_servers.drawio]\ncommand = "drawio-mcp"\nargs = ["--stdio"]\n';
  fs.writeFileSync(claudeFile, claudeText);
  fs.mkdirSync(path.dirname(codexFile), { recursive: true });
  fs.writeFileSync(codexFile, codexText);

  const r = run(['disable', '--mcp', 'drawio', '--dry-run', '--lang', 'en'], home);

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would remove drawio from ~\/\.claude\.json/);
  assert.match(r.stdout, /would disable \[mcp_servers\.drawio\]/);
  assert.match(r.stdout, /\[dry-run\] no changes made\./);
  assert.equal(fs.readFileSync(claudeFile, 'utf8'), claudeText);
  assert.equal(fs.readFileSync(codexFile, 'utf8'), codexText);
  assert.equal(fs.existsSync(path.join(home, '.skill-manager', 'backups')), false);
  assert.equal(fs.existsSync(path.join(home, '.skill-manager', 'mcp-disabled.json')), false);
});

function run(args, home) {
  return spawnSync(process.execPath, ['bin/skm.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, SKM_LANG: 'en' },
  });
}

function makeHome(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(home, '.skill-manager'), { recursive: true });
  return home;
}
