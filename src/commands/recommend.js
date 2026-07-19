import { mergeByDirName, toolLabel } from '../catalog.js';
import { tokenize } from '../similarity.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { fmtAgo } from '../utils.js';
import { renderTable, termWidth } from '../table.js';
import { ensureCatalog } from './scan.js';

const DEFAULT_TOP = 3;
const MAX_TOP = 20;
const RECENT_30D = 30 * 86400e3;
const RECENT_90D = 90 * 86400e3;

const SYNONYMS = [
  ['小红书', ['xhs', 'image', 'card', 'infographic']],
  ['公众号', ['wechat', 'markdown', 'article']],
  ['公众号文章', ['wechat', 'article', 'markdown']],
  ['微信', ['wechat']],
  ['飞书', ['lark']],
  ['会议纪要', ['meeting', 'minutes', 'summary']],
  ['会议总结', ['meeting', 'summary']],
  ['推特', ['twitter', 'x']],
  ['推文', ['tweet', 'twitter', 'x']],
  ['网页', ['url', 'web', 'html']],
  ['网页抓取', ['url', 'web', 'extract', 'markdown']],
  ['网站', ['url', 'web', 'html']],
  ['链接', ['url']],
  ['文章', ['article', 'markdown', 'writer']],
  ['知识库', ['knowledge', 'kb']],
  ['图片', ['image', 'photo']],
  ['图像', ['image', 'photo']],
  ['封面', ['cover', 'image']],
  ['海报', ['poster', 'image']],
  ['压缩', ['compress']],
  ['视频', ['video']],
  ['动画', ['animation']],
  ['幻灯片', ['ppt', 'slide', 'presentation']],
  ['演示', ['ppt', 'slide', 'presentation']],
  ['设计稿', ['design', 'figma', 'ui']],
  ['代码迁移', ['migrate', 'code']],
  ['简历', ['resume']],
  ['邮件', ['email']],
  ['翻译', ['translate', 'translation']],
  ['代码审查', ['review', 'pr', 'code']],
];

// skm recommend：根据自然语言任务描述推荐最合适的 skill。
// 不调用外部模型，只用本地目录、同义词扩展、方向识别、文本相关性、使用频率与两侧可用性综合排序。
export function runRecommend({ cwd, keywords, json = false, top, tool, category, why = false }) {
  const query = keywords.join(' ').trim();
  if (!query) {
    console.error('用法：skm recommend "我要做的事" [--top 3] [--tool claude|codex] [--category 关键字] [--why]');
    process.exitCode = 1;
    return;
  }
  const limit = parseTop(top);
  if (limit == null) return;

  const catalog = ensureCatalog(cwd);
  const merged = filterSkills(mergeByDirName(catalog.skills), { tool, category });
  if (!merged.length) {
    console.log('没有符合过滤条件的 skill，无法推荐。');
    return;
  }

  console.error('正在结合目录与使用统计生成推荐…');
  const usage = scanUsage({ log: (msg) => console.error(msg) });
  const usageOf = buildUsageLookup(merged, usage);
  const ranked = rankRecommendations(merged, query, usageOf).slice(0, limit);

  if (json) {
    console.log(JSON.stringify(ranked.map(toJsonRow), null, 2));
    return;
  }

  if (!ranked.length) {
    console.log(`暂未找到适合"${query}"的 skill。可尝试换关键词，或运行 skm list 浏览分类。`);
    return;
  }

  console.log(`推荐任务：${query}\n`);
  const columns = why
    ? [
        { title: '推荐', width: 4 },
        { title: '分数', width: 5 },
        { title: '名称', width: 28 },
        { title: '工具', width: 6 },
        { title: '最近使用', width: 10 },
        { title: '命中 / 理由', width: 0 },
      ]
    : [
        { title: '推荐', width: 4 },
        { title: '名称', width: 28 },
        { title: '工具', width: 6 },
        { title: '分类', width: 18 },
        { title: '最近使用', width: 10 },
        { title: '理由', width: 0 },
      ];
  const rows = ranked.map((r, i) => why
    ? [i + 1, r.score, r.skill.dirName, toolLabel(r.skill.tools), fmtAgo(r.usage.lastUsed), explain(r)]
    : [i + 1, r.skill.dirName, toolLabel(r.skill.tools), r.skill.category, fmtAgo(r.usage.lastUsed), r.reasons.join('；')]);
  console.log(renderTable(columns, rows, termWidth()));
  console.log('\n提示：recommend 是本地启发式推荐；复杂任务可结合 skm search 与 skm audit 交叉确认。');
}

export function runAsk({ cwd, keywords, json = false, tool, category }) {
  const query = keywords.join(' ').trim();
  if (!query) {
    console.error('用法：skm ask "我要做的事" [--tool claude|codex] [--category 关键字]');
    process.exitCode = 1;
    return;
  }

  const catalog = ensureCatalog(cwd);
  const merged = filterSkills(mergeByDirName(catalog.skills), { tool, category });
  if (!merged.length) {
    console.log('没有符合过滤条件的 skill，无法推荐。');
    return;
  }

  console.error('正在结合目录与使用统计生成回答…');
  const usage = scanUsage({ log: (msg) => console.error(msg) });
  const usageOf = buildUsageLookup(merged, usage);
  const ranked = rankRecommendations(merged, query, usageOf).slice(0, DEFAULT_TOP);

  if (json) {
    console.log(JSON.stringify(ranked.map(toJsonRow), null, 2));
    return;
  }
  if (!ranked.length) {
    console.log(`暂未找到适合"${query}"的 skill。建议先运行 skm search <关键词> 或 skm list 浏览分类。`);
    return;
  }

  const [best, ...rest] = ranked;
  console.log(`任务：${query}\n`);
  console.log(`首选：${best.skill.dirName}（${toolLabel(best.skill.tools)}，${best.skill.category}）`);
  console.log(`理由：${best.reasons.join('；')}。`);
  if (best.skill.description) console.log(`说明：${best.skill.description}`);
  if (rest.length) {
    console.log('\n备选：');
    for (const r of rest) {
      console.log(`  - ${r.skill.dirName}：${r.reasons.slice(0, 3).join('；')}`);
    }
  }
  console.log(`\n进一步确认：skm recommend "${query.replace(/"/g, '\\"')}" --why`);
}

export function rankRecommendations(skills, query, usageOf = () => ({ count: 0, lastUsed: null })) {
  const queryTerms = expandQuery(query);
  const queryTokens = tokenize(queryTerms.join(' '));
  const requiredTerms = coreTerms(query);
  const direction = detectDirection(query);
  const rows = skills.map((skill) => {
    const usage = usageOf(skill);
    const scored = scoreSkill(skill, queryTerms, queryTokens, requiredTerms, direction, usage);
    return { skill, usage, ...scored };
  });
  return rows
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.usage.count - a.usage.count || a.skill.dirName.localeCompare(b.skill.dirName));
}

function scoreSkill(skill, queryTerms, queryTokens, requiredTerms, direction, usage) {
  let score = 0;
  const reasonSet = new Set();
  const matchedTerms = new Set();
  const nameText = `${skill.dirName} ${skill.name}`.toLowerCase();
  const category = String(skill.category || '').toLowerCase();
  const desc = String(skill.description || '').toLowerCase();
  const haystackTokens = tokenize(`${skill.dirName} ${skill.name} ${skill.category} ${skill.description}`);
  const fullText = `${nameText} ${category} ${desc}`;

  if (requiredTerms.length && !requiredTerms.some((term) => fullText.includes(term))) {
    return { score: 0, reasons: [], matchedTerms: [], direction };
  }

  const directionScore = scoreDirection(fullText, direction);
  if (directionScore.blocked) {
    return { score: 0, reasons: [], matchedTerms: [], direction, blockedReason: directionScore.reason };
  }
  if (direction.source.length && direction.target.length && directionScore.score === 0) {
    return { score: 0, reasons: [], matchedTerms: [], direction, blockedReason: '转换方向不明确' };
  }
  if (directionScore.score > 0) {
    score += directionScore.score;
    reasonSet.add(directionScore.reason);
  }

  for (const term of queryTerms) {
    if (!term) continue;
    if (nameText.includes(term)) {
      score += 12;
      reasonSet.add('名称高度匹配');
      matchedTerms.add(term);
    } else if (category.includes(term)) {
      score += 8;
      reasonSet.add('分类匹配');
      matchedTerms.add(term);
    } else if (desc.includes(term)) {
      score += 5;
      reasonSet.add('描述匹配');
      matchedTerms.add(term);
    }
  }

  let overlap = 0;
  for (const token of queryTokens) {
    if (haystackTokens.has(token)) {
      overlap++;
      matchedTerms.add(token);
    }
  }
  if (queryTokens.size) score += Math.round((overlap / queryTokens.size) * 20);
  if (overlap > 0) reasonSet.add('任务词相似');

  // 使用频率只能作为相关候选的加权项，不能让不相关但常用的 skill 混入推荐。
  if (score === 0) return { score: 0, reasons: [], matchedTerms: [], direction };

  if (skill.tools.length > 1) {
    score += 4;
    reasonSet.add('Claude/Codex 两侧可用');
  }
  if (usage.count > 0) {
    score += Math.min(8, 3 + Math.floor(Math.log2(usage.count + 1)));
    reasonSet.add(`历史用过 ${usage.count} 次`);
    const age = usage.lastUsed ? Date.now() - Date.parse(usage.lastUsed) : null;
    if (age != null && age <= RECENT_30D) {
      score += 3;
      reasonSet.add('最近 30 天用过');
    } else if (age != null && age <= RECENT_90D) {
      score += 1;
      reasonSet.add('最近 90 天用过');
    }
  }

  return {
    score,
    reasons: [...reasonSet],
    matchedTerms: [...matchedTerms].slice(0, 8),
    direction,
  };
}

function expandQuery(query) {
  const lower = query.toLowerCase();
  const terms = new Set(lower.split(/\s+/).filter(Boolean));
  terms.add(lower);
  for (const [key, values] of SYNONYMS) {
    if (lower.includes(key)) for (const v of values) terms.add(v);
  }
  return [...terms];
}

function coreTerms(query) {
  return (query.toLowerCase().match(/[a-z0-9._-]{2,}/g) || [])
    .filter((term) => !['web', 'url'].includes(term));
}

function detectDirection(query) {
  const lower = query.toLowerCase();
  const source = new Set();
  const target = new Set();
  const addSource = (terms) => terms.forEach((t) => source.add(t));
  const addTarget = (terms) => terms.forEach((t) => target.add(t));

  const cn = lower.match(/(?:转成|转为|转换为)\s*([a-z0-9._-]+)/);
  const to = lower.match(/\bto\s+([a-z0-9._-]+)/);
  const fromTo = lower.match(/\bfrom\s+([a-z0-9._-]+)\s+to\s+([a-z0-9._-]+)/);
  if (cn) addTarget([cn[1]]);
  if (to) addTarget([to[1]]);
  if (fromTo) {
    addSource([fromTo[1]]);
    addTarget([fromTo[2]]);
  }
  if (lower.includes('markdown') || lower.includes('md')) {
    if (/markdown\s*(?:to|转|转成|转为)\s*html|md\s*(?:to|转|转成|转为)\s*html/.test(lower)) {
      addSource(['markdown', 'md']);
      addTarget(['html']);
    } else if (/html\s*(?:to|转|转成|转为)\s*(?:markdown|md)/.test(lower)) {
      addSource(['html']);
      addTarget(['markdown', 'md']);
    }
  }
  if (lower.includes('网页') || lower.includes('网站') || lower.includes('链接')) addSource(['url', 'web', 'html']);
  if (lower.includes('公众号')) addSource(['wechat', 'article']);
  if (lower.includes('图片') || lower.includes('图像')) addTarget(['image']);
  if (lower.includes('小红书')) addTarget(['xhs', 'image', 'card']);

  return { source: [...source], target: [...target] };
}

function scoreDirection(fullText, { source, target }) {
  if (!target.length) return { score: 0, reason: '' };
  for (const t of target) {
    for (const s of source) {
      if (new RegExp(`${escapeRe(s)}[- ]to[- ]${escapeRe(t)}`).test(fullText) || fullText.includes(`convert ${s} to ${t}`)) {
        return { score: 14, reason: `方向匹配：${s} → ${t}` };
      }
      if (new RegExp(`${escapeRe(t)}[- ]to[- ]${escapeRe(s)}`).test(fullText) || fullText.includes(`convert ${t} to ${s}`)) {
        return { score: 0, blocked: true, reason: `方向相反：${t} → ${s}` };
      }
    }
    if (new RegExp(`(?:to|转成|转为)[- ]?${escapeRe(t)}`).test(fullText) || fullText.includes(`convert to ${t}`)) {
      return { score: 8, reason: `目标匹配：${t}` };
    }
  }
  return { score: 0, reason: '' };
}

function filterSkills(skills, { tool, category }) {
  let out = skills;
  if (tool) {
    const normalized = tool === 'claude' ? 'claude-code' : tool;
    out = out.filter((s) => s.tools.includes(normalized));
  }
  if (category) {
    const q = category.toLowerCase();
    out = out.filter((s) => String(s.category || '').toLowerCase().includes(q));
  }
  return out;
}

function parseTop(value) {
  if (value == null) return DEFAULT_TOP;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`--top 需要 1-${MAX_TOP} 的正整数，收到：${value}`);
    process.exitCode = 1;
    return null;
  }
  return Math.min(MAX_TOP, n);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function explain(r) {
  const hits = r.matchedTerms.length ? `命中 ${r.matchedTerms.join(', ')}` : '无命中词';
  return `${hits}；${r.reasons.join('；')}`;
}

function toJsonRow(r) {
  return {
    dirName: r.skill.dirName,
    name: r.skill.name,
    category: r.skill.category,
    tools: r.skill.tools,
    description: r.skill.description,
    count: r.usage.count,
    lastUsed: r.usage.lastUsed,
    score: r.score,
    reasons: r.reasons,
    matchedTerms: r.matchedTerms,
    direction: r.direction,
  };
}
