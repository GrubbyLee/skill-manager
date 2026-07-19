import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRecommendations } from '../src/commands/recommend.js';

const skill = (dirName, description, extra = {}) => ({
  dirName,
  name: dirName,
  category: extra.category || '内容抓取与转换',
  description,
  tools: extra.tools || ['claude-code'],
});

test('推荐排序：名称/描述匹配优先，并结合两侧可用与历史使用', () => {
  const skills = [
    skill('baoyu-url-to-markdown', 'Fetch any URL and convert to markdown', { tools: ['claude-code', 'codex'] }),
    skill('baoyu-markdown-to-html', 'Converts Markdown to styled HTML', { tools: ['claude-code', 'codex'] }),
    skill('email-draft-polish', 'Draft and polish emails', { category: '商务与文书' }),
  ];
  const usage = {
    'baoyu-url-to-markdown': { count: 8, lastUsed: new Date().toISOString() },
    'baoyu-markdown-to-html': { count: 0, lastUsed: null },
    'email-draft-polish': { count: 20, lastUsed: new Date().toISOString() },
  };
  const ranked = rankRecommendations(skills, '把网页转成 markdown', (m) => usage[m.dirName] || { count: 0, lastUsed: null });
  assert.equal(ranked[0].skill.dirName, 'baoyu-url-to-markdown');
  assert.ok(ranked[0].reasons.includes('Claude/Codex 两侧可用'));
  assert.ok(ranked[0].reasons.some((r) => r.startsWith('历史用过')));
  assert.equal(ranked.some((r) => r.skill.dirName === 'email-draft-polish'), false);
});

test('推荐排序：中文同义词能命中英文目录名', () => {
  const skills = [
    skill('baoyu-xhs-images', 'Generates infographic image card sets for Xiaohongshu', { category: '图像与视觉' }),
    skill('baoyu-url-to-markdown', 'Fetch any URL and convert to markdown'),
  ];
  const ranked = rankRecommendations(skills, '做小红书图片卡片');
  assert.equal(ranked[0].skill.dirName, 'baoyu-xhs-images');
});

test('推荐排序：英文核心词必须真实命中，避免泛词干扰', () => {
  const skills = [
    skill('baoyu-url-to-markdown', 'Fetch any URL and convert to markdown', { tools: ['claude-code', 'codex'] }),
    skill('baoyu-markdown-to-html', 'Converts Markdown to styled HTML', { tools: ['claude-code', 'codex'] }),
    skill('ui-ux-pro-max', 'UI/UX design intelligence for web and mobile', { category: '设计与 UI', tools: ['claude-code', 'codex'] }),
  ];
  const ranked = rankRecommendations(skills, '把网页转成 markdown');
  assert.deepEqual(ranked.map((r) => r.skill.dirName), ['baoyu-url-to-markdown']);
});

test('推荐排序：识别转换方向，避免推荐反向 skill', () => {
  const skills = [
    skill('baoyu-markdown-to-html', 'Converts Markdown to styled HTML', { tools: ['claude-code', 'codex'] }),
    skill('baoyu-html-to-markdown', 'Convert HTML pages to markdown', { tools: ['claude-code', 'codex'] }),
  ];
  let ranked = rankRecommendations(skills, 'markdown to html');
  assert.equal(ranked[0].skill.dirName, 'baoyu-markdown-to-html');
  assert.equal(ranked.some((r) => r.skill.dirName === 'baoyu-html-to-markdown'), false);

  ranked = rankRecommendations(skills, 'html to markdown');
  assert.equal(ranked[0].skill.dirName, 'baoyu-html-to-markdown');
  assert.equal(ranked.some((r) => r.skill.dirName === 'baoyu-markdown-to-html'), false);
});
