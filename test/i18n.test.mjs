import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, fmtAgoLang, normalizeLang, tr } from '../src/i18n.js';

test('i18n：语言归一化与默认检测', () => {
  assert.equal(normalizeLang('zh_CN.UTF-8'), 'zh-CN');
  assert.equal(normalizeLang('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLang('en_US.UTF-8'), 'en');
  assert.equal(normalizeLang('fr_FR'), null);
  assert.equal(detectLang('en'), 'en');
  assert.equal(detectLang('zh-CN'), 'zh-CN');
});

test('i18n：翻译函数支持参数', () => {
  assert.equal(tr('en', 'scan.tokens', { n: 42 }), 'about 42 tokens');
  assert.equal(tr('zh-CN', 'scan.tokens', { n: 42 }), '约 42 token');
});

test('i18n：英文相对时间按日历日展示', () => {
  const now = Date.parse('2026-07-21T03:00:00Z');
  assert.equal(fmtAgoLang('en', '2026-07-21T01:00:00Z', now), 'today');
  assert.equal(fmtAgoLang('en', '2026-07-20T01:00:00Z', now), 'yesterday');
});
