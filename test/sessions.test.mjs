import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDeletions } from '../src/sessionsIndex.js';
import { toggleTomlSection } from '../src/commands/toggle.js';

const DAY = 86400e3;
const now = 100 * DAY;
const mk = (name, ageDays, size = 1) => ({ path: name, mtimeMs: now - ageDays * DAY, size });

test('清理策略：keep 与 days 取并集，24 小时内活跃永不删', () => {
  const files = [mk('a', 0.5), mk('b', 5), mk('c', 40), mk('d', 80)];
  // 只按天数：保留 30 天内（a、b）+24h 保护（a）→ 删 c、d
  let r = selectDeletions(files, { days: 30, nowMs: now });
  assert.deepEqual(r.toDelete.map((f) => f.path), ['c', 'd']);
  // keep 3 ∪ 30 天内 → 保留 a b c，删 d
  r = selectDeletions(files, { keep: 3, days: 30, nowMs: now });
  assert.deepEqual(r.toDelete.map((f) => f.path), ['d']);
  // keep 0 且 days 0：仍保留 24 小时内的 a
  r = selectDeletions(files, { keep: 0, days: 0, nowMs: now });
  assert.deepEqual(r.kept.map((f) => f.path), ['a']);
});

test('TOML 段落注释：只动目标 server 及其子表，且可逆', () => {
  const toml = `[mcp_servers]

[mcp_servers.foo]
command = "npx"

[mcp_servers.foo.env]
KEY = "v"

[mcp_servers.bar]
command = "other"
`;
  const off = toggleTomlSection(toml, 'foo', true);
  assert.equal(off.touched, 4);
  assert.ok(off.text.includes('#skm# [mcp_servers.foo]'));
  assert.ok(off.text.includes('#skm# KEY = "v"'));
  assert.ok(off.text.includes('\n[mcp_servers.bar]'));
  assert.ok(!off.text.includes('#skm# [mcp_servers.bar]'));
  const on = toggleTomlSection(off.text, 'foo', false);
  assert.equal(on.text, toml);
});

test('TOML 段落注释：下一节表头带行尾注释时也能正确终止块，不误伤无关节', () => {
  const toml = `[mcp_servers.foo]
command = "npx"

[model_providers.bar] # 备用
key = "v"
`;
  const off = toggleTomlSection(toml, 'foo', true);
  assert.equal(off.touched, 2);
  assert.ok(off.text.includes('\n[model_providers.bar] # 备用'));
  assert.ok(!off.text.includes('#skm# [model_providers.bar]'));
  assert.ok(!off.text.includes('#skm# key'));
});
