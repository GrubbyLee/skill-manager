import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTomlSections } from '../src/toml.js';
import { tokenize, jaccard } from '../src/similarity.js';
import { displayWidth, truncate, pad } from '../src/table.js';
import { fmtDay, fmtDateTime } from '../src/utils.js';

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

test('时间：按 Asia/Shanghai 展示（UTC 20:00 = 北京次日）', () => {
  assert.equal(fmtDay('2026-07-18T20:00:00Z'), '2026-07-19');
  assert.equal(fmtDateTime('2026-07-18T20:00:00Z'), '2026-07-19 04:00');
  assert.equal(fmtDay(null), '—');
});
