import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, fallbackDescription } from '../src/frontmatter.js';

test('解析常规 frontmatter', () => {
  const { data, hasFrontmatter } = parseFrontmatter('---\nname: foo\ndescription: "带引号 描述"\n---\n\n# 正文');
  assert.equal(hasFrontmatter, true);
  assert.equal(data.name, 'foo');
  assert.equal(data.description, '带引号 描述');
});

test('折叠块与缩进续行拼接为一行', () => {
  const text = '---\nname: bar\ndescription: >\n  第一行\n  第二行\n---\n';
  assert.equal(parseFrontmatter(text).data.description, '第一行 第二行');
});

test('分隔线尾随空格仍能解析（编辑器常见残留）', () => {
  const text = '--- \nname: baz\ndescription: 描述\n--- \n\n正文';
  const { data, hasFrontmatter } = parseFrontmatter(text);
  assert.equal(hasFrontmatter, true);
  assert.equal(data.name, 'baz');
  assert.equal(fallbackDescription(text), '正文');
});

test('无 frontmatter 时返回空对象并可从正文兜底取描述', () => {
  const text = '# 标题\n\n这是第一段正文。\n';
  const { data, hasFrontmatter } = parseFrontmatter(text);
  assert.equal(hasFrontmatter, false);
  assert.deepEqual(data, {});
  assert.equal(fallbackDescription(text), '这是第一段正文。');
});
