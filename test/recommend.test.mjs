import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdvisorCandidates,
  buildAdvisorPrompt,
  parseAdvisorOutput,
  rankRecommendations,
} from '../src/commands/recommend.js';

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

test('推荐排序：中文任务意图优先命中专用 skill', () => {
  const skills = [
    skill('baoyu-comic', 'Knowledge comic creator supporting storyboard panels', { category: '图像与视觉' }),
    skill('baoyu-cover-image', 'Generates article cover images', { category: '图像与视觉' }),
    skill('content-research-writer', 'Assists in writing high-quality articles', { category: '翻译与写作' }),
  ];

  const ranked = rankRecommendations(skills, '给 README 做四格漫画分镜');
  assert.equal(ranked[0].skill.dirName, 'baoyu-comic');
  assert.ok(ranked[0].reasons.includes('意图匹配：漫画/分镜'));
  assert.ok(ranked[0].intents.includes('漫画/分镜'));
});

test('推荐排序：图谱类任务命中数据与图谱能力，历史高频无关项不混入', () => {
  const skills = [
    skill('baoyu-diagram', 'Create professional diagrams and knowledge graph visuals', { category: '数据与图谱' }),
    skill('email-draft-polish', 'Draft and polish emails', { category: '商务与文书' }),
  ];
  const usage = {
    'baoyu-diagram': { count: 0, lastUsed: null },
    'email-draft-polish': { count: 99, lastUsed: new Date().toISOString() },
  };

  const ranked = rankRecommendations(skills, '生成漂亮的知识图谱', (m) => usage[m.dirName] || { count: 0, lastUsed: null });
  assert.equal(ranked[0].skill.dirName, 'baoyu-diagram');
  assert.equal(ranked.some((r) => r.skill.dirName === 'email-draft-polish'), false);
});

test('增强推荐：候选清单来自扫描结果但不暴露路径字段', () => {
  const skills = [
    { ...skill('baoyu-comic', 'Knowledge comic creator supporting storyboard panels', { category: '图像与视觉' }), path: '/secret/path', realPath: '/secret/real' },
    { ...skill('baoyu-diagram', 'Create professional diagrams and knowledge graph visuals', { category: '数据与图谱' }), path: '/secret/path2' },
  ];
  const ranked = rankRecommendations(skills, '做四格漫画');
  const candidates = buildAdvisorCandidates(skills, ranked);
  const prompt = buildAdvisorPrompt({ query: '做四格漫画', candidates, top: 2 });

  assert.equal(candidates[0].dirName, 'baoyu-comic');
  assert.equal(Object.hasOwn(candidates[0], 'path'), false);
  assert.equal(Object.hasOwn(candidates[0], 'realPath'), false);
  assert.match(prompt, /候选列表来自用户本机扫描目录/);
  assert.doesNotMatch(prompt, /\/secret\//);
});

test('增强推荐：解析 JSON 并过滤候选列表之外的名称', () => {
  const output = `说明文字
  {"summary":"优先用图谱工具","recommendations":[
    {"dirName":"baoyu-diagram","confidence":0.91,"reason":"直接匹配知识图谱","whenToUse":"需要关系图时"},
    {"dirName":"unknown-skill","confidence":1,"reason":"不应保留"}
  ],"warnings":["仅基于候选清单"]}`;

  const parsed = parseAdvisorOutput(output, new Set(['baoyu-diagram']));
  assert.equal(parsed.summary, '优先用图谱工具');
  assert.equal(parsed.recommendations.length, 1);
  assert.equal(parsed.recommendations[0].dirName, 'baoyu-diagram');
  assert.equal(parsed.recommendations[0].confidence, 0.91);
  assert.deepEqual(parsed.warnings, ['仅基于候选清单']);
});
