import { spawn } from 'node:child_process';
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
const CORE_TERM_STOP_WORDS = new Set(['web', 'url', 'readme', 'docs', 'doc']);
const ADVISORS = new Set(['codex', 'claude']);
const ADVISOR_CANDIDATE_LIMIT = 60;
const ADVISOR_TIMEOUT_MS = 90_000;
const DESCRIPTION_LIMIT = 180;

const SYNONYMS = [
  ['自建', ['scan', 'audit', 'status', 'diagnose']],
  ['排查', ['debug', 'diagnose', 'triage', 'audit', 'fix']],
  ['诊断', ['debug', 'diagnose', 'triage', 'audit']],
  ['修复', ['fix', 'debug', 'review']],
  ['报错', ['error', 'debug', 'fix']],
  ['工作流', ['workflow', 'agent']],
  ['知识图谱', ['knowledge', 'graph', 'diagram']],
  ['图谱', ['graph', 'diagram']],
  ['关系图', ['graph', 'diagram']],
  ['漫画', ['comic', 'image', 'illustration']],
  ['插画', ['illustrator', 'image']],
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

const TASK_INTENTS = [
  {
    key: 'comic',
    label: '漫画/分镜',
    triggers: ['漫画', '分镜', '四格', 'comic', 'manga'],
    positives: ['comic', '漫画', 'storyboard', 'image', 'illustration'],
    categories: ['图像与视觉'],
  },
  {
    key: 'image',
    label: '图像生成/处理',
    triggers: ['图片', '图像', '封面', '海报', '插画', '配图', 'image', 'poster', 'cover'],
    positives: ['image', 'photo', 'cover', 'poster', 'illustrator', 'infographic', 'compress'],
    categories: ['图像与视觉'],
  },
  {
    key: 'graph',
    label: '图谱/关系可视化',
    triggers: ['知识图谱', '图谱', '关系图', '流程图', 'diagram', 'graph', 'mermaid', 'drawio'],
    positives: ['graph', 'diagram', 'knowledge', 'chart', 'mermaid', 'drawio', '图谱'],
    categories: ['数据与图谱'],
  },
  {
    key: 'web_extract',
    label: '网页抓取/转换',
    triggers: ['网页', '网站', '链接', '抓取', 'url', 'html', 'webpage'],
    positives: ['url', 'web', 'html', 'markdown', 'extract', 'fetch'],
    categories: ['内容抓取与转换'],
  },
  {
    key: 'slides',
    label: '演示文稿',
    triggers: ['ppt', 'slides', '幻灯片', '演示文稿', '汇报'],
    positives: ['ppt', 'slide', 'slides', 'presentation'],
    categories: ['演示文稿（PPT/Slides）'],
  },
  {
    key: 'meeting',
    label: '会议纪要',
    triggers: ['会议纪要', '会议总结', '会议记录', 'meeting', 'minutes'],
    positives: ['meeting', 'minutes', 'summary', 'transcript'],
    categories: ['办公协作（飞书）'],
  },
  {
    key: 'code_review',
    label: '代码审查/CI',
    triggers: ['代码审查', 'pr', 'pull request', 'ci', 'review', '单测', '测试失败'],
    positives: ['review', 'pr', 'pull', 'ci', 'test', 'fix'],
    categories: ['研发辅助'],
  },
  {
    key: 'writing',
    label: '写作/润色',
    triggers: ['写作', '润色', '文案', '文章', '邮件', 'email', 'draft', 'polish'],
    positives: ['writer', 'writing', 'article', 'email', 'draft', 'polish'],
    categories: ['翻译与写作', '商务与文书'],
  },
  {
    key: 'translate',
    label: '翻译',
    triggers: ['翻译', 'translate', 'translation'],
    positives: ['translate', 'translation'],
    categories: ['翻译与写作'],
  },
];

// skm recommend：根据自然语言任务描述推荐最合适的 skill。
// 默认不调用外部模型；仅显式传 --advisor codex|claude 时，才调用本机 AIDE CLI 做增强推荐。
export async function runRecommend({ cwd, keywords, json = false, top, tool, category, why = false, advisor }) {
  const query = keywords.join(' ').trim();
  if (!query) {
    console.error('用法：skm recommend "我要做的事" [--top 3] [--tool claude|codex] [--category 关键字] [--why] [--advisor codex|claude]');
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
  let advisorResult = null;
  let advisorError = null;

  if (advisor) {
    const candidates = buildAdvisorCandidates(merged, ranked, usageOf);
    if (!candidates.length) {
      advisorError = '没有可发送给增强推荐的候选 skill';
    } else {
      console.error(`正在调用本机 ${advisor} 增强推荐…`);
      try {
        advisorResult = await askAdvisor({ advisor, query, candidates, top: limit, cwd });
      } catch (e) {
        advisorError = e.message || String(e);
        console.error(`增强推荐不可用：${advisorError}，已回退本地推荐。`);
      }
    }
  }

  if (json) {
    if (advisor) {
      console.log(JSON.stringify({
        query,
        advisor: advisorResult || { name: advisor, status: 'fallback', error: advisorError },
        recommendations: ranked.map(toJsonRow),
      }, null, 2));
    } else {
      console.log(JSON.stringify(ranked.map(toJsonRow), null, 2));
    }
    return;
  }

  if (!ranked.length) {
    console.log(`暂未找到适合"${query}"的本地规则推荐。可尝试换关键词，或运行 skm list 浏览分类。`);
    if (advisorResult) printAdvisorResult(advisorResult);
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
  if (advisorResult) printAdvisorResult(advisorResult);
  if (advisorError && !advisorResult) console.log(`\n增强推荐：${advisor} 不可用，已使用本地推荐。原因：${advisorError}`);
  console.log('\n提示：recommend 默认是本地启发式推荐；显式加 --advisor codex|claude 时会调用本机 AIDE CLI 做增强判断。');
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
  const profile = analyzeTask(query);
  const queryTerms = expandQuery(query, profile);
  const queryTokens = tokenize(queryTerms.join(' '));
  const requiredTerms = coreTerms(query);
  const direction = detectDirection(query);
  const rows = skills.map((skill) => {
    const usage = usageOf(skill);
    const scored = scoreSkill(skill, queryTerms, queryTokens, requiredTerms, direction, usage, profile);
    return { skill, usage, ...scored };
  });
  return rows
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.usage.count - a.usage.count || a.skill.dirName.localeCompare(b.skill.dirName));
}

export function buildAdvisorCandidates(skills, ranked, usageOf = () => ({ count: 0, lastUsed: null })) {
  const out = [];
  const seen = new Set();
  const addSkill = (skill, local = null) => {
    if (!skill || seen.has(skill.dirName) || out.length >= ADVISOR_CANDIDATE_LIMIT) return;
    seen.add(skill.dirName);
    const usage = local?.usage || usageOf(skill) || { count: 0, lastUsed: null };
    out.push({
      dirName: skill.dirName,
      name: skill.name,
      category: skill.category,
      tools: skill.tools,
      description: truncateText(skill.description || '', DESCRIPTION_LIMIT),
      usageCount: usage.count || 0,
      lastUsed: usage.lastUsed || null,
      localScore: local?.score || 0,
      localReasons: local?.reasons || [],
      localIntents: local?.intents || [],
    });
  };

  for (const local of ranked) addSkill(local.skill, local);
  const rest = [...skills].sort((a, b) => {
    const au = usageOf(a)?.count || 0;
    const bu = usageOf(b)?.count || 0;
    return bu - au || b.tools.length - a.tools.length || a.dirName.localeCompare(b.dirName);
  });
  for (const skill of rest) addSkill(skill);
  return out;
}

export async function askAdvisor({ advisor, query, candidates, top = DEFAULT_TOP, cwd, spawnImpl = spawn, timeoutMs = ADVISOR_TIMEOUT_MS }) {
  if (!ADVISORS.has(advisor)) throw new Error(`--advisor 取值应为 codex|claude，收到：${advisor}`);
  const prompt = buildAdvisorPrompt({ query, candidates, top });
  const invocation = advisorInvocation(advisor, prompt);
  const result = await runAdvisorProcess(invocation, { cwd, spawnImpl, timeoutMs });
  const parsed = parseAdvisorOutput(result.stdout, new Set(candidates.map((c) => c.dirName)));
  return {
    name: advisor,
    status: 'ok',
    summary: parsed.summary,
    recommendations: parsed.recommendations,
    warnings: parsed.warnings,
    candidateCount: candidates.length,
  };
}

export function buildAdvisorPrompt({ query, candidates, top = DEFAULT_TOP }) {
  const payload = {
    task: query,
    top,
    candidates,
  };
  return [
    '你是 skm 的 skill 推荐增强器。请只基于下面 JSON 中的候选 skill 做判断。',
    '不要读取文件，不要联网，不要执行命令，不要假设候选列表之外还存在其他 skill。',
    '候选列表来自用户本机扫描目录，但已去除路径、配置和环境变量。',
    '请输出严格 JSON，不要输出 Markdown，不要包裹代码块。',
    'JSON 结构：{"summary":"一句话结论","recommendations":[{"dirName":"候选中的目录名","confidence":0.0到1.0,"reason":"为什么适合","whenToUse":"什么情况下用它"}],"warnings":["可选风险或提醒"]}',
    'recommendations 最多返回 top 个；dirName 必须完全等于 candidates 中的 dirName。',
    JSON.stringify(payload, null, 2),
  ].join('\n\n');
}

export function parseAdvisorOutput(output, validNames) {
  const jsonText = extractJsonObject(output);
  if (!jsonText) throw new Error('增强推荐没有返回可解析 JSON');
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('增强推荐返回的 JSON 格式无效');
  }
  const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const clean = recommendations
    .map((r) => ({
      dirName: String(r.dirName || r.name || '').trim(),
      confidence: normalizeConfidence(r.confidence),
      reason: truncateText(String(r.reason || '').trim(), 240),
      whenToUse: truncateText(String(r.whenToUse || '').trim(), 180),
    }))
    .filter((r) => r.dirName && validNames.has(r.dirName));
  if (!clean.length) throw new Error('增强推荐没有返回有效候选名称');
  return {
    summary: truncateText(String(parsed.summary || '').trim(), 240),
    recommendations: clean.slice(0, MAX_TOP),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((w) => truncateText(String(w), 180)).filter(Boolean).slice(0, 5)
      : [],
  };
}

function scoreSkill(skill, queryTerms, queryTokens, requiredTerms, direction, usage, profile) {
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

  const intentScore = scoreIntent(skill, fullText, profile);
  if (intentScore.score > 0) {
    score += intentScore.score;
    for (const reason of intentScore.reasons) reasonSet.add(reason);
    for (const term of intentScore.matchedTerms) matchedTerms.add(term);
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
    intents: profile.intents.map((i) => i.label),
  };
}

function expandQuery(query, profile = { terms: [] }) {
  const lower = query.toLowerCase();
  const terms = new Set(lower.split(/\s+/).filter(Boolean));
  terms.add(lower);
  for (const [key, values] of SYNONYMS) {
    if (lower.includes(key)) for (const v of values) terms.add(v);
  }
  for (const term of profile.terms || []) terms.add(term);
  return [...terms];
}

function analyzeTask(query) {
  const lower = query.toLowerCase();
  const intents = TASK_INTENTS.filter((intent) => intent.triggers.some((t) => lower.includes(t.toLowerCase())));
  const terms = new Set();
  for (const intent of intents) {
    for (const term of intent.positives) terms.add(term);
  }
  return { intents, terms: [...terms] };
}

function scoreIntent(skill, fullText, profile) {
  const reasons = [];
  const matchedTerms = [];
  let score = 0;
  if (!profile.intents.length) return { score, reasons, matchedTerms };

  const category = String(skill.category || '');
  for (const intent of profile.intents) {
    const termHits = intent.positives.filter((term) => fullText.includes(term.toLowerCase()));
    const categoryHit = Boolean(category) && intent.categories.some((c) => category.includes(c) || c.includes(category));
    if (!termHits.length && !categoryHit) continue;

    const partScore = Math.min(18, termHits.length * 5 + (categoryHit ? 6 : 0));
    score += partScore;
    reasons.push(`意图匹配：${intent.label}`);
    for (const term of termHits.slice(0, 4)) matchedTerms.push(term);
  }
  return { score, reasons, matchedTerms };
}

function coreTerms(query) {
  return (query.toLowerCase().match(/[a-z0-9._-]{2,}/g) || [])
    .filter((term) => !CORE_TERM_STOP_WORDS.has(term));
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

function advisorInvocation(advisor, prompt) {
  if (advisor === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '--sandbox', 'read-only', '--ask-for-approval', 'never', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '-'],
      stdin: prompt,
    };
  }
  return {
    command: 'claude',
    args: ['--print', '--input-format', 'text', '--output-format', 'text', '--permission-mode', 'dontAsk', '--tools', '', '--no-session-persistence'],
    stdin: prompt,
  };
}

function runAdvisorProcess(invocation, { cwd, spawnImpl, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(invocation.command, invocation.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      if (child.kill) child.kill('SIGTERM');
      reject(new Error(`增强推荐超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (e.code === 'ENOENT') reject(new Error(`找不到命令：${invocation.command}`));
      else reject(e);
    });
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${invocation.command} 退出码 ${code}${stderr.trim() ? `：${truncateText(stderr.trim(), 220)}` : ''}`));
    });
    if (invocation.stdin) child.stdin?.end(invocation.stdin);
    else child.stdin?.end();
  });
}

function printAdvisorResult(result) {
  console.log(`\n增强推荐（${result.name}）：${result.summary || '已返回建议'}`);
  for (const [i, r] of result.recommendations.entries()) {
    const confidence = Math.round(r.confidence * 100);
    console.log(`  ${i + 1}. ${r.dirName}（置信度 ${confidence}%）：${r.reason}`);
    if (r.whenToUse) console.log(`     适用：${r.whenToUse}`);
  }
  for (const warning of result.warnings || []) {
    console.log(`  提醒：${warning}`);
  }
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : raw;
  const start = s.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}

function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
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

function truncateText(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
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
    intents: r.intents || [],
  };
}
