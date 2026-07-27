import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRecommendations } from '../src/commands/recommend.js';
import {
  evaluateRecommendationBenchmark,
  loadRecommendationBenchmark,
} from '../scripts/benchmark-recommend.mjs';

const benchmark = loadRecommendationBenchmark();

test('推荐基准：语料匿名、双语且案例 ID 唯一', () => {
  assert.ok(benchmark.skills.length >= 20);
  assert.ok(benchmark.cases.length >= 40);
  assert.equal(new Set(benchmark.cases.map((sample) => sample.id)).size, benchmark.cases.length);
  assert.ok(benchmark.cases.some((sample) => sample.lang === 'zh-CN'));
  assert.ok(benchmark.cases.some((sample) => sample.lang === 'en'));

  const serialized = JSON.stringify(benchmark);
  assert.doesNotMatch(serialized, /(?:\/home\/|[A-Z]:\\\\Users\\\\|\.ssh|api[_-]?key)/i);
});

test('推荐基准：准确率达到回归门槛且不返回已知错误候选', () => {
  const result = evaluateRecommendationBenchmark(benchmark);

  assert.equal(result.total, benchmark.cases.length);
  assert.ok(result.top1 >= 0.95, `Top 1 过低：${result.top1}`);
  assert.ok(result.top3 >= 0.98, `Top 3 过低：${result.top3}`);
  assert.ok(result.mrr >= 0.97, `MRR 过低：${result.mrr}`);
  assert.equal(result.knownErrorRate, 0);
  assert.ok(result.byLang.en.top1 >= 0.9);
  assert.ok(result.byLang['zh-CN'].top1 >= 0.9);
});

test('推荐改写：不要求中文动作词与宾语相邻', () => {
  const ranked = rankRecommendations(benchmark.skills, '整理下载目录中的文件');
  assert.equal(ranked[0].skill.dirName, 'file-organizer');
});

test('推荐改写：正文插画优先文章配图工具', () => {
  const ranked = rankRecommendations(benchmark.skills, '为博客正文生成几张插画');
  assert.equal(ranked[0].skill.dirName, 'baoyu-article-illustrator');
});

test('推荐方向：语言翻译不按文件格式转换处理', () => {
  const ranked = rankRecommendations(benchmark.skills, 'translate this document from English to Japanese');
  assert.equal(ranked[0].skill.dirName, 'baoyu-translate');
});

test('推荐触发：英文短词只匹配完整单词', () => {
  const ranked = rankRecommendations(benchmark.skills, 'create an XHS infographic card set');
  assert.equal(ranked[0].skill.dirName, 'baoyu-xhs-images');
  assert.equal(ranked[0].intents.includes('图谱/关系可视化'), false);
});

test('推荐意图：中文名称和描述的专用 skill 不会被错误过滤', () => {
  const skills = [
    {
      dirName: '商务邮件助手',
      name: '商务邮件助手',
      category: '商务与文书',
      description: '撰写并润色中文商务邮件',
      tools: ['codex'],
    },
    {
      dirName: '通用写作助手',
      name: '通用写作助手',
      category: '商务与文书',
      description: '润色各类中文文稿',
      tools: ['codex'],
    },
  ];

  const ranked = rankRecommendations(skills, '帮我润色一封邮件');
  assert.equal(ranked[0].skill.dirName, '商务邮件助手');
  assert.equal(ranked.some((row) => row.skill.dirName === '通用写作助手'), false);
});
