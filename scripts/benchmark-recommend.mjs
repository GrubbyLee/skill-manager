import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rankRecommendations } from '../src/commands/recommend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'benchmarks', 'recommendation.json');

export function loadRecommendationBenchmark(file = DEFAULT_FILE) {
  const resolved = path.resolve(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取推荐基准 ${resolved}：${error.message}`);
  }
  validateBenchmark(data, resolved);
  return data;
}

export function evaluateRecommendationBenchmark(data) {
  validateBenchmark(data, '传入数据');
  const rows = data.cases.map((sample) => evaluateCase(data.skills, sample));
  return {
    ...summarize(rows),
    byLang: Object.fromEntries(
      [...new Set(rows.map((row) => row.lang))]
        .sort()
        .map((lang) => [lang, summarize(rows.filter((row) => row.lang === lang))]),
    ),
    rows,
  };
}

function evaluateCase(skills, sample) {
  const ranked = rankRecommendations(skills, sample.query);
  const names = ranked.map((row) => row.skill.dirName);
  const expected = new Set(sample.expected);
  const firstIndex = names.findIndex((name) => expected.has(name));
  const firstRelevant = firstIndex === -1 ? null : firstIndex + 1;
  const topThreeNames = names.slice(0, 3);
  const forbiddenInTop3 = topThreeNames.filter((name) => sample.forbidden.includes(name));

  return {
    id: sample.id,
    lang: sample.lang,
    query: sample.query,
    expected: sample.expected,
    forbidden: sample.forbidden,
    result: topThreeNames,
    firstRelevant,
    top1: firstRelevant === 1,
    top3: firstRelevant != null && firstRelevant <= 3,
    reciprocalRank: firstRelevant == null ? 0 : 1 / firstRelevant,
    forbiddenInTop3,
  };
}

function summarize(rows) {
  const total = rows.length;
  const top1Count = rows.filter((row) => row.top1).length;
  const top3Count = rows.filter((row) => row.top3).length;
  const knownErrorCount = rows.filter((row) => row.forbiddenInTop3.length > 0).length;
  return {
    total,
    top1: total ? top1Count / total : 0,
    top3: total ? top3Count / total : 0,
    mrr: total ? rows.reduce((sum, row) => sum + row.reciprocalRank, 0) / total : 0,
    knownErrorRate: total ? knownErrorCount / total : 0,
    top1Count,
    top3Count,
    knownErrorCount,
  };
}

function validateBenchmark(data, source) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`推荐基准格式无效（${source}）：根节点必须是对象`);
  }
  if (!Array.isArray(data.skills) || data.skills.length === 0) {
    throw new Error(`推荐基准格式无效（${source}）：skills 必须是非空数组`);
  }
  if (!Array.isArray(data.cases) || data.cases.length === 0) {
    throw new Error(`推荐基准格式无效（${source}）：cases 必须是非空数组`);
  }

  const skillNames = new Set();
  for (const [index, skill] of data.skills.entries()) {
    if (!skill || typeof skill.dirName !== 'string' || !skill.dirName.trim()) {
      throw new Error(`推荐基准格式无效（${source}）：skills[${index}].dirName 不能为空`);
    }
    if (skillNames.has(skill.dirName)) {
      throw new Error(`推荐基准格式无效（${source}）：skill 名称重复：${skill.dirName}`);
    }
    if (!Array.isArray(skill.tools)) {
      throw new Error(`推荐基准格式无效（${source}）：${skill.dirName}.tools 必须是数组`);
    }
    skillNames.add(skill.dirName);
  }

  const caseIds = new Set();
  for (const [index, sample] of data.cases.entries()) {
    const prefix = `cases[${index}]`;
    if (!sample || typeof sample.id !== 'string' || !sample.id.trim()) {
      throw new Error(`推荐基准格式无效（${source}）：${prefix}.id 不能为空`);
    }
    if (caseIds.has(sample.id)) {
      throw new Error(`推荐基准格式无效（${source}）：案例 ID 重复：${sample.id}`);
    }
    if (typeof sample.query !== 'string' || !sample.query.trim()) {
      throw new Error(`推荐基准格式无效（${source}）：${sample.id}.query 不能为空`);
    }
    if (typeof sample.lang !== 'string' || !sample.lang.trim()) {
      throw new Error(`推荐基准格式无效（${source}）：${sample.id}.lang 不能为空`);
    }
    if (!Array.isArray(sample.expected) || sample.expected.length === 0) {
      throw new Error(`推荐基准格式无效（${source}）：${sample.id}.expected 必须是非空数组`);
    }
    if (!Array.isArray(sample.forbidden)) {
      throw new Error(`推荐基准格式无效（${source}）：${sample.id}.forbidden 必须是数组`);
    }
    for (const name of [...sample.expected, ...sample.forbidden]) {
      if (!skillNames.has(name)) {
        throw new Error(`推荐基准格式无效（${source}）：${sample.id} 引用了不存在的 skill：${name}`);
      }
    }
    caseIds.add(sample.id);
  }
}

function formatRate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printSummary(label, result) {
  console.log(
    `${label.padEnd(8)} 样本 ${String(result.total).padStart(2)} | `
    + `Top 1 ${formatRate(result.top1)} | Top 3 ${formatRate(result.top3)} | `
    + `MRR ${result.mrr.toFixed(3)} | 已知错误率 ${formatRate(result.knownErrorRate)}`,
  );
}

function printReport(result) {
  console.log('skm 推荐准确率基准\n');
  printSummary('总体', result);
  for (const [lang, summary] of Object.entries(result.byLang)) printSummary(lang, summary);

  const failures = result.rows.filter((row) => !row.top1 || row.forbiddenInTop3.length > 0);
  if (!failures.length) {
    console.log('\n所有案例均在 Top 1 命中，且 Top 3 未出现已知错误候选。');
    return;
  }

  console.log(`\n待改进案例（${failures.length}）：`);
  for (const row of failures) {
    const rank = row.firstRelevant == null ? '未命中' : `第 ${row.firstRelevant} 名`;
    const resultText = row.result.length ? row.result.join(', ') : '无结果';
    console.log(`- ${row.id} [${row.lang}] ${rank}`);
    console.log(`  任务：${row.query}`);
    console.log(`  期望：${row.expected.join(', ')}；结果：${resultText}`);
    if (row.forbiddenInTop3.length) console.log(`  已知错误：${row.forbiddenInTop3.join(', ')}`);
  }
}

async function main() {
  const file = process.argv[2] || DEFAULT_FILE;
  const data = loadRecommendationBenchmark(file);
  printReport(evaluateRecommendationBenchmark(data));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
