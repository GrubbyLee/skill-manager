import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTomlSections } from '../src/toml.js';
import { tokenize, jaccard } from '../src/similarity.js';
import { displayWidth, truncate, pad } from '../src/table.js';
import { fmtDay, fmtDateTime, fmtAgo, fmtBytes, DAY_MS } from '../src/utils.js';
import { computeHealthScore } from '../src/commands/status.js';
import { planClean } from '../src/sessionsIndex.js';

test('TOML：抽取 mcp_servers 小节及键值', () => {
  const toml = `
[mcp_servers]

[mcp_servers.demo]
type = "stdio"
command = "npx"
args = ["-y", "@x/mcp"]

[mcp_servers.demo.env]
SECRET = "should-not-matter"
`;
  const sections = parseTomlSections(toml);
  assert.equal(sections['mcp_servers.demo'].command, 'npx');
  assert.deepEqual(sections['mcp_servers.demo'].args, ['-y', '@x/mcp']);
  assert.ok(sections['mcp_servers.demo.env']);
});

test('TOML：数组元素内含逗号/空格的引号字符串不被劈开，表头允许行尾注释', () => {
  const toml = `
[mcp_servers.demo] # 备用说明
args = ["run", "--flag=a,b", "含 空格"]
`;
  const sections = parseTomlSections(toml);
  assert.deepEqual(sections['mcp_servers.demo'].args, ['run', '--flag=a,b', '含 空格']);
});

test('TOML：键值的行尾内联注释被剥离', () => {
  const toml = `
[mcp_servers.demo]
command = "npx" # runner
port = 8080 # 端口
flag = true # 开关
`;
  const s = parseTomlSections(toml)['mcp_servers.demo'];
  assert.equal(s.command, 'npx');
  assert.equal(s.port, 8080);
  assert.equal(s.flag, true);
});

test('相似度：相同文本为 1，无交集为 0', () => {
  const a = tokenize('generate ppt slides 生成演示文稿');
  assert.equal(jaccard(a, a), 1);
  assert.equal(jaccard(a, tokenize('database migration')), 0);
});

test('表格：中文按宽度 2 计算并正确截断补齐', () => {
  assert.equal(displayWidth('ab中文'), 6);
  assert.equal(displayWidth(pad('中', 6)), 6);
  const t = truncate('中文很长的描述文本', 8);
  assert.ok(displayWidth(t) <= 8);
  assert.ok(t.endsWith('…'));
});

test('时间：按 Asia/Shanghai 展示（UTC 20:00 = 北京次日），脏时间戳不显示 Invalid Date', () => {
  assert.equal(fmtDay('2026-07-18T20:00:00Z'), '2026-07-19');
  assert.equal(fmtDateTime('2026-07-18T20:00:00Z'), '2026-07-19 04:00');
  assert.equal(fmtDay(null), '—');
  assert.equal(fmtDay('not-a-date'), '—');
  assert.equal(fmtDateTime('garbage'), '—');
});

test('相对时间：今天/昨天/N 天前/N 个月前，脏值回退', () => {
  const now = Date.now();
  assert.equal(fmtAgo(new Date(now - 3.5 * DAY_MS).toISOString(), now), '3 天前');
  assert.equal(fmtAgo(new Date(now - 0.2 * DAY_MS).toISOString(), now), '今天');
  assert.equal(fmtAgo(new Date(now - 1.5 * DAY_MS).toISOString(), now), '昨天');
  assert.equal(fmtAgo(new Date(now - 65 * DAY_MS).toISOString(), now), '2 个月前');
  assert.equal(fmtAgo(null, now), '—');
  assert.equal(fmtAgo('bad', now), '—');
});

test('健康分：边界与扣分上限', () => {
  assert.equal(computeHealthScore({ zombieRate: 0, dupGroups: 0, idleMcp: 0, logBytes: 0 }), 100);
  // 65% 僵尸(-26) + 39 组双份(上限-20) + 1 闲置 MCP(-5) + 1.8GB 日志(上限-15) = 34
  assert.equal(computeHealthScore({ zombieRate: 0.65, dupGroups: 39, idleMcp: 1, logBytes: 1.8e9 }), 34);
  // 极端情况不为负
  assert.equal(computeHealthScore({ zombieRate: 1, dupGroups: 99, idleMcp: 9, logBytes: 9e9 }), 10);
  assert.equal(fmtBytes(1.8e9), '1.8GB');
});

test('清理规划：未知工作区仅按天数，无 --days 时整组跳过', () => {
  const now = 100 * DAY_MS;
  const mk = (path, workspace, ageDays) => ({ path, workspace, size: 1, mtimeMs: now - ageDays * DAY_MS });
  const sessions = [mk('a', '/w1', 60), mk('b', '/w1', 2), mk('u1', null, 60), mk('u2', null, 50)];
  // 只有 keep：未知组整组跳过
  let r = planClean(sessions, { keep: 1, nowMs: now });
  assert.equal(r.skippedUnknown, 2);
  assert.deepEqual(r.groups.flatMap((g) => g.toDelete.map((f) => f.path)), ['a']);
  // 有 days：未知组按天数参与清理
  r = planClean(sessions, { days: 30, nowMs: now });
  assert.equal(r.skippedUnknown, 0);
  assert.deepEqual(r.groups.flatMap((g) => g.toDelete.map((f) => f.path)).sort(), ['a', 'u1', 'u2']);
});
