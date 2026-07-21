import fs from 'node:fs';
import path from 'node:path';
import { mergeByDirName, toolLabel, isDupEntity } from '../catalog.js';
import { tokenize, jaccard } from '../similarity.js';
import { scanUsage, buildUsageLookup } from '../usage.js';
import { fmtDateTime, groupBy } from '../utils.js';
import { renderTable, termWidth } from '../table.js';
import { ensureCatalog } from './scan.js';
import { fmtAgoLang, tr } from '../i18n.js';

const EDGE_LIMITS = {
  alternative: 40,
};

const EDGE_LABELS = {
  same_family: '同源',
  same_category: '同类',
  duplicate: '重复',
  alternative: '替代',
  pipeline: '流程',
  reverse_transform: '反向转换',
  shared_platform: '共享平台',
  uses_mcp: '使用 MCP',
};

const EDGE_LABELS_EN = {
  same_family: 'same family',
  same_category: 'same category',
  duplicate: 'duplicate',
  alternative: 'alternative',
  pipeline: 'workflow',
  reverse_transform: 'reverse conversion',
  shared_platform: 'shared platform',
  uses_mcp: 'uses MCP',
};

const EDGE_DESCRIPTIONS = {
  same_family: '同源：目录名前缀相同，通常表示同一作者、同一套工具包或同一组能力，例如 baoyu-*、lark-*。适合观察成组安装与套件边界。',
  same_category: '同类：根据分类规则归入同一业务类别，表示用途相近但不一定互相依赖。该关系数量通常较多，适合做全局盘点。',
  duplicate: '重复：不同安装记录的 SKILL.md 内容哈希完全相同，表示实质上是同一份 skill。适合清理重复安装和降低上下文开销。',
  alternative: '替代：同分类下名称或描述高度相似，但不属于同一前缀组。它们可能解决相近任务，适合比较保留哪一个。',
  pipeline: '流程：一个 skill 的输出格式可以作为另一个 skill 的输入格式，例如 URL 转 Markdown 后再转 HTML。适合发现可串联的工作流。',
  reverse_transform: '反向转换：两个 skill 的转换方向相反，例如 Markdown 转 HTML 与 HTML 转 Markdown。适合识别互补工具。',
  shared_platform: '共享平台：名称或描述命中同一外部平台关键词，例如 GitHub、飞书、Notion。该关系数量通常较多，适合按平台查看生态。',
  uses_mcp: '使用 MCP：skill 描述中同时命中 MCP 与具体 MCP server 名称，表示它可能依赖或调用该 MCP 能力。当前属于推断关系。',
};

const EDGE_DESCRIPTIONS_EN = {
  same_family: 'Same family: directory name prefixes match, usually meaning the same author, toolkit, or capability suite, such as baoyu-* or lark-*.',
  same_category: 'Same category: classification rules put these skills into the same business category. They are related by use case, not necessarily dependent.',
  duplicate: 'Duplicate: SKILL.md content hashes are identical across install records. Useful for cleaning duplicate installs and reducing context cost.',
  alternative: 'Alternative: names or descriptions are highly similar within the same category but not in the same prefix family. Useful when deciding which tool to keep.',
  pipeline: 'Workflow: one skill output can be another skill input, such as URL to Markdown followed by Markdown to HTML.',
  reverse_transform: 'Reverse conversion: two skills convert in opposite directions, such as Markdown to HTML and HTML to Markdown.',
  shared_platform: 'Shared platform: names or descriptions match the same external platform keyword, such as GitHub, Lark, or Notion.',
  uses_mcp: 'Uses MCP: a skill description mentions both MCP and a specific MCP server name. This is inferred, not guaranteed.',
};

const DEFAULT_VISIBLE_EDGE_TYPES = new Set([
  'same_family',
  'duplicate',
  'alternative',
  'pipeline',
  'reverse_transform',
  'uses_mcp',
]);

const EDGE_COLORS = {
  same_family: '#8b5cf6',
  same_category: '#38bdf8',
  duplicate: '#ef4444',
  alternative: '#f59e0b',
  pipeline: '#22c55e',
  reverse_transform: '#f97316',
  shared_platform: '#14b8a6',
  uses_mcp: '#e879f9',
};

const PLATFORM_RULES = [
  ['WeChat', ['wechat', '微信', '公众号']],
  ['X / Twitter', ['twitter', 'tweet', 'tweets', '推特', '推文']],
  ['Lark / 飞书', ['lark', '飞书']],
  ['Notion', ['notion']],
  ['GitHub', ['github', 'pull request', 'pr ', 'issue']],
  ['Linear', ['linear']],
  ['Slack', ['slack']],
  ['Datadog', ['datadog']],
  ['Sentry', ['sentry']],
  ['YouTube', ['youtube']],
  ['XHS / 小红书', ['xhs', 'xiaohongshu', '小红书']],
  ['OpenAI', ['openai', 'gpt']],
  ['Codex', ['codex']],
  ['Claude', ['claude']],
  ['Figma', ['figma']],
];

const TRANSFORM_ALIASES = new Map([
  ['md', 'markdown'],
  ['webpage', 'url'],
  ['web', 'url'],
  ['page', 'url'],
  ['wechat', 'wechat'],
  ['x', 'twitter'],
]);

export function runGraph({ cwd, format, output, json = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);
  const resolvedFormat = resolveFormat({ format, output, json });

  console.error(tr(lang, 'graph.loading'));
  const usage = scanUsage({ log: (msg) => console.error(msg), lang });
  const graph = buildKnowledgeGraph(catalog, usage);

  if (resolvedFormat === 'summary') return printSummary(graph, catalog, lang);

  const text = renderGraph(graph, resolvedFormat, lang);
  if (output) {
    writeTextFile(output, text);
    console.log(tr(lang, 'graph.exported', { output }));
    return;
  }
  console.log(text);
}

export function buildKnowledgeGraph(catalog, usage = { skills: {}, mcp: {} }) {
  const merged = mergeByDirName(catalog.skills || []);
  const usageOf = buildUsageLookup(merged, usage);
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeKeys = new Set();

  const addNode = (node) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge) => {
    const key = `${edge.source}|${edge.target}|${edge.type}`;
    if (edge.source === edge.target || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ label: EDGE_LABELS[edge.type] || edge.type, ...edge });
  };

  const skillByName = new Map();
  for (const skill of merged) {
    const u = usageOf(skill);
    const family = familyOf(skill.dirName);
    const platforms = detectPlatforms(skill);
    const transforms = detectTransforms(skill);
    const duplicateEntity = isDupEntity(skill);
    const node = {
      id: skillId(skill.dirName),
      label: skill.dirName,
      type: 'skill',
      category: skill.category,
      tools: skill.tools,
      toolLabel: toolLabel(skill.tools),
      family,
      platforms,
      transforms,
      usageCount: u.count,
      lastUsed: u.lastUsed,
      descTokens: skill.descTokens || 0,
      duplicateEntity,
      description: skill.description || '',
      confidence: 'explicit',
    };
    addNode(node);
    skillByName.set(skill.dirName, { skill, node });
  }

  addMcpNodes(catalog, usage, addNode);
  addCategoryEdges(merged, addNode, addEdge);
  addFamilyEdges(merged, addNode, addEdge);
  addPlatformEdges(merged, addNode, addEdge);
  addDuplicateEdges(catalog.skills || [], addEdge);
  addTransformEdges([...skillByName.values()].map((v) => v.node), addEdge);
  addAlternativeEdges([...skillByName.values()].map((v) => v.node), addEdge);
  addMcpEdges([...skillByName.values()].map((v) => v.node), catalog.mcpServers || [], addEdge);

  const stats = {
    skills: nodes.filter((n) => n.type === 'skill').length,
    mcp: nodes.filter((n) => n.type === 'mcp').length,
    categories: nodes.filter((n) => n.type === 'category').length,
    families: nodes.filter((n) => n.type === 'family').length,
    platforms: nodes.filter((n) => n.type === 'platform').length,
    edges: edges.length,
    edgeTypes: Object.fromEntries([...groupBy(edges, (e) => e.type)].map(([type, list]) => [type, list.length])),
  };

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    scannedAt: catalog.scannedAt || null,
    nodes,
    edges,
    stats,
    legend: EDGE_LABELS,
  };
}

function addMcpNodes(catalog, usage, addNode) {
  const byName = groupBy(catalog.mcpServers || [], (m) => m.name);
  for (const [name, entries] of byName) {
    const u = usage.mcp?.[name] || { count: 0, lastUsed: null };
    addNode({
      id: mcpId(name),
      label: name,
      type: 'mcp',
      tools: [...new Set(entries.map((e) => e.tool))],
      transport: [...new Set(entries.map((e) => e.transport).filter(Boolean))].join(' / '),
      usageCount: u.count,
      lastUsed: u.lastUsed,
      description: entries.map((e) => e.command).filter(Boolean).join(' | '),
      confidence: 'explicit',
    });
  }
}

function addCategoryEdges(skills, addNode, addEdge) {
  for (const skill of skills) {
    const category = skill.category || '未分类';
    const id = categoryId(category);
    addNode({ id, label: category, type: 'category', confidence: 'structural' });
    addEdge({
      source: skillId(skill.dirName),
      target: id,
      type: 'same_category',
      confidence: 'structural',
      reason: `分类规则归为「${category}」`,
    });
  }
}

function addFamilyEdges(skills, addNode, addEdge) {
  const byFamily = groupBy(skills, (s) => familyOf(s.dirName));
  for (const [family, list] of byFamily) {
    if (!family || list.length < 2) continue;
    const id = familyId(family);
    addNode({ id, label: `${family}-*`, type: 'family', family, confidence: 'structural' });
    for (const skill of list) {
      addEdge({
        source: skillId(skill.dirName),
        target: id,
        type: 'same_family',
        confidence: 'structural',
        reason: `目录名前缀同为 ${family}`,
      });
    }
  }
}

function addPlatformEdges(skills, addNode, addEdge) {
  for (const skill of skills) {
    for (const platform of detectPlatforms(skill)) {
      const id = platformId(platform);
      addNode({ id, label: platform, type: 'platform', confidence: 'inferred' });
      addEdge({
        source: skillId(skill.dirName),
        target: id,
        type: 'shared_platform',
        confidence: 'inferred',
        reason: `名称或描述命中平台关键词：${platform}`,
      });
    }
  }
}

function addDuplicateEdges(skills, addEdge) {
  const byHash = new Map();
  const seenReal = new Set();
  for (const s of skills) {
    if (seenReal.has(s.realPath)) continue;
    seenReal.add(s.realPath);
    if (!byHash.has(s.skillMdHash)) byHash.set(s.skillMdHash, []);
    byHash.get(s.skillMdHash).push(s);
  }
  for (const list of byHash.values()) {
    const names = [...new Set(list.map((s) => s.dirName))];
    if (names.length < 2) continue;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        addEdge({
          source: skillId(names[i]),
          target: skillId(names[j]),
          type: 'duplicate',
          confidence: 'explicit',
          reason: 'SKILL.md 内容哈希完全相同',
        });
      }
    }
  }
}

function addTransformEdges(nodes, addEdge) {
  const transformNodes = nodes.filter((n) => n.transforms.length);
  for (let i = 0; i < transformNodes.length; i++) {
    for (let j = i + 1; j < transformNodes.length; j++) {
      const a = transformNodes[i];
      const b = transformNodes[j];
      for (const ta of a.transforms) {
        for (const tb of b.transforms) {
          if (ta.from === tb.to && ta.to === tb.from) {
            addEdge({
              source: a.id,
              target: b.id,
              type: 'reverse_transform',
              confidence: Math.min(ta.confidenceScore, tb.confidenceScore) >= 2 ? 'structural' : 'inferred',
              reason: `${ta.from} ↔ ${ta.to} 转换方向相反`,
            });
          }
          if (ta.to === tb.from) {
            addEdge({
              source: a.id,
              target: b.id,
              type: 'pipeline',
              confidence: Math.min(ta.confidenceScore, tb.confidenceScore) >= 2 ? 'structural' : 'inferred',
              reason: `${a.label} 输出 ${ta.to}，${b.label} 接收 ${tb.from}`,
            });
          }
          if (tb.to === ta.from) {
            addEdge({
              source: b.id,
              target: a.id,
              type: 'pipeline',
              confidence: Math.min(ta.confidenceScore, tb.confidenceScore) >= 2 ? 'structural' : 'inferred',
              reason: `${b.label} 输出 ${tb.to}，${a.label} 接收 ${ta.from}`,
            });
          }
        }
      }
    }
  }
}

function addAlternativeEdges(nodes, addEdge) {
  const byCategory = groupBy(nodes.filter((n) => n.type === 'skill' && n.description), (n) => n.category);
  const pairs = [];
  for (const list of byCategory.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].family && list[i].family === list[j].family) continue;
        const score = jaccard(
          tokenize(`${list[i].label} ${list[i].description}`),
          tokenize(`${list[j].label} ${list[j].description}`),
        );
        if (score >= 0.4) pairs.push({ a: list[i], b: list[j], score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs.slice(0, EDGE_LIMITS.alternative)) {
    addEdge({
      source: p.a.id,
      target: p.b.id,
      type: 'alternative',
      confidence: 'inferred',
      score: Number(p.score.toFixed(2)),
      reason: `同分类且名称/描述相似度 ${Math.round(p.score * 100)}%`,
    });
  }
}

function addMcpEdges(skillNodes, mcpServers, addEdge) {
  const mcpNames = [...new Set(mcpServers.map((m) => m.name))];
  for (const skill of skillNodes) {
    const text = `${skill.label} ${skill.description}`.toLowerCase();
    if (!text.includes('mcp')) continue;
    for (const name of mcpNames) {
      if (!text.includes(name.toLowerCase())) continue;
      addEdge({
        source: skill.id,
        target: mcpId(name),
        type: 'uses_mcp',
        confidence: 'inferred',
        reason: `skill 描述同时命中 MCP 与 ${name}`,
      });
    }
  }
}

function printSummary(graph, catalog, lang = 'zh-CN') {
  console.log(`${tr(lang, 'graph.title')}\n`);
  console.log(renderTable(
    [{ title: tr(lang, 'graph.summary.col.item'), width: 20 }, { title: tr(lang, 'graph.summary.col.count'), width: 0 }],
    [
      [tr(lang, 'graph.summary.skillNodes'), tr(lang, 'graph.unit.items', { n: graph.stats.skills })],
      [tr(lang, 'graph.summary.mcpNodes'), tr(lang, 'graph.unit.items', { n: graph.stats.mcp })],
      [tr(lang, 'graph.summary.categoryNodes'), tr(lang, 'graph.unit.items', { n: graph.stats.categories })],
      [tr(lang, 'graph.summary.familyNodes'), tr(lang, 'graph.unit.items', { n: graph.stats.families })],
      [tr(lang, 'graph.summary.platformNodes'), tr(lang, 'graph.unit.items', { n: graph.stats.platforms })],
      [tr(lang, 'graph.summary.edges'), tr(lang, 'graph.unit.edges', { n: graph.stats.edges })],
      [tr(lang, 'graph.summary.scannedAt'), fmtDateTime(catalog.scannedAt)],
    ],
    Math.min(termWidth(), 80),
  ));
  console.log(`\n${tr(lang, 'graph.edgeDistribution')}`);
  console.log(renderTable(
    [{ title: tr(lang, 'graph.col.edge'), width: 18 }, { title: tr(lang, 'graph.summary.col.count'), width: 0 }],
    Object.entries(graph.stats.edgeTypes).sort((a, b) => b[1] - a[1]).map(([type, n]) => [edgeLabel(type, lang), tr(lang, 'graph.unit.edges', { n })]),
    Math.min(termWidth(), 60),
  ));
  console.log(`\n${tr(lang, 'graph.export')}`);
  console.log('  skm graph --format html --output skill-graph.html');
  console.log('  skm graph --format json --output skill-graph.json');
  console.log('  skm graph --format mermaid --output skill-graph.md');
}

export function renderGraph(graph, format, lang = 'zh-CN') {
  if (format === 'json') return JSON.stringify(graph, null, 2);
  if (format === 'mermaid') return renderMermaid(graph, lang);
  if (format === 'html') return renderHtml(graph, lang);
  throw new Error(tr(lang, 'graph.unsupportedFormat', { format }));
}

function renderMermaid(graph, lang = 'zh-CN') {
  const lines = ['```mermaid', 'graph LR'];
  for (const n of graph.nodes) {
    lines.push(`  ${mermaidId(n.id)}["${escapeMermaid(n.label)}"]`);
  }
  for (const e of graph.edges) {
    lines.push(`  ${mermaidId(e.source)} -->|"${escapeMermaid(edgeLabel(e.type, lang))}"| ${mermaidId(e.target)}`);
  }
  lines.push('```');
  return lines.join('\n');
}

function renderHtml(graph, lang = 'zh-CN') {
  const layout = layoutGraph(graph);
  const positions = layout.positions;
  const degrees = graphDegrees(graph.edges);
  const edges = graph.edges.map((e) => {
    const a = positions.get(e.source);
    const b = positions.get(e.target);
    if (!a || !b) return '';
    const color = EDGE_COLORS[e.type] || '#94a3b8';
    return `<line class="edge edge-${e.type}" data-type="${e.type}" data-source="${escapeHtml(e.source)}" data-target="${escapeHtml(e.target)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${edgeWidth(e)}"><title>${escapeHtml(edgeLabel(e.type, lang))}${lang === 'en' ? ': ' : '：'}${escapeHtml(e.reason || '')}</title></line>`;
  }).join('\n');
  const nodes = graph.nodes.map((n) => {
    const p = positions.get(n.id);
    const color = nodeColor(n);
    const radius = nodeRadius(n);
    const muted = n.type === 'skill' && !n.usageCount ? ' muted' : '';
    const degree = degrees.get(n.id) || 0;
    const important = isImportantNode(n, degree);
    return `<g class="node node-${n.type}${muted}" data-type="${n.type}" data-id="${escapeHtml(n.id)}" data-x="${p.x}" data-y="${p.y}" data-initial-x="${p.x}" data-initial-y="${p.y}" data-degree="${degree}" data-usage="${n.usageCount || 0}" data-important="${important}" data-search="${escapeHtml(nodeSearchText(n))}" transform="translate(${p.x},${p.y})">
      <circle r="${radius}" fill="${color}" stroke="${nodeStroke(n)}" stroke-width="${n.duplicateEntity ? 3 : 1.5}"></circle>
      <text y="${radius + 13}" text-anchor="middle">${escapeHtml(shortLabel(n.label, n.type === 'skill' ? 22 : 18))}</text>
      <title>${escapeHtml(nodeTitle(n, lang))}</title>
    </g>`;
  }).join('\n');
  const edgeControls = Object.keys(EDGE_LABELS).map((type) => {
    const label = edgeLabel(type, lang);
    const count = graph.stats.edgeTypes[type] || 0;
    const checked = DEFAULT_VISIBLE_EDGE_TYPES.has(type) ? ' checked' : '';
    const help = edgeDescription(type, lang) || `${label}: skill graph relationship.`;
    return `<label class="edge-option"><input type="checkbox" data-edge="${type}"${checked}> <span class="swatch" style="border-color:${EDGE_COLORS[type]}"></span><span class="edge-help" tabindex="0" data-help="${escapeHtml(help)}">${label} (${count})</span></label>`;
  }).join('');
  const visibleText = JSON.stringify(tr(lang, 'graph.html.visible', { nodes: '__NODES__', edges: '__EDGES__' }));
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(tr(lang, 'graph.html.title'))}</title>
<style>
  :root { color-scheme: dark; --bg:#0b1020; --panel:#111827; --text:#e5e7eb; --muted:#94a3b8; --line:#334155; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }
  header { padding:24px 28px 12px; border-bottom:1px solid #1f2937; background:linear-gradient(180deg,#111827,#0b1020); }
  h1 { margin:0 0 8px; font-size:24px; font-weight:700; }
  .meta { color:var(--muted); font-size:13px; }
  .wrap { display:grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 89px); }
  aside { padding:18px; border-right:1px solid #1f2937; background:#0f172a; overflow:auto; }
  main { overflow:auto; }
  .stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:18px; }
  .stat { background:var(--panel); border:1px solid #1f2937; border-radius:8px; padding:10px; }
  .stat b { display:block; font-size:20px; }
  .stat span { color:var(--muted); font-size:12px; }
  label { color:#cbd5e1; font-size:13px; }
  .edge-option { display:flex; align-items:flex-start; gap:7px; margin:9px 0; }
  .edge-option input { margin-top:2px; flex:0 0 auto; }
  .swatch { display:inline-block; width:10px; height:10px; border-left:4px solid; margin-top:4px; flex:0 0 auto; }
  .edge-help { position:relative; cursor:help; line-height:1.35; border-bottom:1px dotted #64748b; outline:none; }
  .edge-help::after { content:attr(data-help); position:absolute; left:0; top:calc(100% + 8px); width:250px; box-sizing:border-box; padding:10px 12px; border:1px solid #334155; border-radius:8px; background:#020617; color:#e5e7eb; box-shadow:0 12px 28px rgba(0,0,0,.35); font-size:12px; line-height:1.55; white-space:normal; visibility:hidden; opacity:0; transform:translateY(-3px); transition:opacity .12s, transform .12s; z-index:5; pointer-events:none; }
  .edge-help:hover::after, .edge-help:focus::after { visibility:visible; opacity:1; transform:translateY(0); }
  input[type="search"] { width:100%; box-sizing:border-box; margin:8px 0 16px; padding:8px 10px; border-radius:8px; border:1px solid #334155; background:#020617; color:var(--text); }
  .toggles { display:grid; gap:8px; margin:12px 0 16px; }
  .toggle { display:flex; align-items:center; gap:8px; }
  .toolbar { display:flex; gap:8px; margin:8px 0 14px; }
  button { cursor:pointer; border:1px solid #334155; border-radius:8px; background:#1e293b; color:#e5e7eb; padding:7px 10px; font-size:12px; }
  button:hover { background:#334155; }
  svg { display:block; min-width:${layout.width}px; min-height:${layout.height}px; background:radial-gradient(circle at 50% 45%, #111827 0, #020617 70%); user-select:none; }
  .edge { opacity:.38; transition:opacity .15s; }
  .node { cursor:grab; touch-action:none; }
  .node text { fill:#dbeafe; font-size:11px; pointer-events:none; }
  .node circle { filter: drop-shadow(0 4px 10px rgba(0,0,0,.35)); }
  .node.dragging { cursor:grabbing; }
  .node.dragging circle { stroke:#f8fafc; stroke-width:3; }
  .node.muted circle { opacity:.42; }
  svg.labels-off .node text { display:none; }
  .hidden { display:none; }
  footer { color:var(--muted); font-size:12px; line-height:1.5; margin-top:18px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(tr(lang, 'graph.html.title'))}</h1>
  <div class="meta">${escapeHtml(tr(lang, 'graph.html.generated'))}：${escapeHtml(fmtDateTime(graph.generatedAt))} · skill ${graph.stats.skills} · MCP ${graph.stats.mcp} · ${escapeHtml(tr(lang, 'graph.html.relations'))} ${graph.stats.edges}</div>
</header>
<div class="wrap">
  <aside>
    <input id="q" type="search" placeholder="${escapeHtml(tr(lang, 'graph.html.search'))}">
    <div class="stats">
      <div class="stat"><b>${graph.stats.skills}</b><span>skill</span></div>
      <div class="stat"><b>${graph.stats.mcp}</b><span>MCP</span></div>
      <div class="stat"><b>${graph.stats.families}</b><span>${escapeHtml(tr(lang, 'graph.html.families'))}</span></div>
      <div class="stat"><b>${graph.stats.edges}</b><span>${escapeHtml(tr(lang, 'graph.html.relations'))}</span></div>
    </div>
    <div id="visible-count" class="meta"></div>
    <div class="toolbar"><button id="reset-layout" type="button">${escapeHtml(tr(lang, 'graph.html.reset'))}</button></div>
    <div class="toggles">
      <label class="toggle"><input id="only-important" type="checkbox"> ${escapeHtml(tr(lang, 'graph.html.onlyImportant'))}</label>
      <label class="toggle"><input id="hide-idle" type="checkbox"> ${escapeHtml(tr(lang, 'graph.html.hideIdle'))}</label>
      <label class="toggle"><input id="show-labels" type="checkbox" checked> ${escapeHtml(tr(lang, 'graph.html.showLabels'))}</label>
    </div>
    <h3>${escapeHtml(tr(lang, 'graph.html.edgeFilter'))}</h3>
    ${edgeControls}
    <footer>${escapeHtml(tr(lang, 'graph.html.footer'))}</footer>
  </aside>
  <main>
    <svg viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${escapeHtml(tr(lang, 'graph.html.aria'))}">
      <g class="edges">${edges}</g>
      <g class="nodes">${nodes}</g>
    </svg>
  </main>
</div>
<script>
const q = document.querySelector('#q');
const nodes = [...document.querySelectorAll('.node')];
const edges = [...document.querySelectorAll('.edge')];
const edgeChecks = [...document.querySelectorAll('[data-edge]')];
const visibleCount = document.querySelector('#visible-count');
const onlyImportant = document.querySelector('#only-important');
const hideIdle = document.querySelector('#hide-idle');
const showLabels = document.querySelector('#show-labels');
const resetLayout = document.querySelector('#reset-layout');
const nodeById = new Map(nodes.map(n => [n.dataset.id, n]));
const svg = document.querySelector('svg');
let dragging = null;

function applyFilters() {
  const enabledTypes = new Set(edgeChecks.filter(cb => cb.checked).map(cb => cb.dataset.edge));
  const term = q.value.trim().toLowerCase();
  const relationNodeIds = new Set();
  const matchedNodeIds = new Set();
  const focusedNodeIds = new Set();

  for (const edge of edges) {
    if (!enabledTypes.has(edge.dataset.type)) continue;
    relationNodeIds.add(edge.dataset.source);
    relationNodeIds.add(edge.dataset.target);
  }
  if (term) {
    for (const node of nodes) {
      if (node.dataset.search.includes(term)) matchedNodeIds.add(node.dataset.id);
    }
    for (const edge of edges) {
      if (!enabledTypes.has(edge.dataset.type)) continue;
      if (!matchedNodeIds.has(edge.dataset.source) && !matchedNodeIds.has(edge.dataset.target)) continue;
      focusedNodeIds.add(edge.dataset.source);
      focusedNodeIds.add(edge.dataset.target);
    }
    for (const id of matchedNodeIds) focusedNodeIds.add(id);
  }

  for (const node of nodes) {
    const matchesRelation = relationNodeIds.has(node.dataset.id);
    const matchesSearch = !term || focusedNodeIds.has(node.dataset.id);
    const matchesImportant = !onlyImportant.checked || node.dataset.important === 'true';
    const matchesIdle = !(hideIdle.checked && node.dataset.type === 'skill' && Number(node.dataset.usage) === 0);
    node.classList.toggle('hidden', !matchesRelation || !matchesSearch || !matchesImportant || !matchesIdle);
  }

  let visibleEdges = 0;
  for (const edge of edges) {
    const source = nodeById.get(edge.dataset.source);
    const target = nodeById.get(edge.dataset.target);
    const show = enabledTypes.has(edge.dataset.type)
      && source && target
      && !source.classList.contains('hidden')
      && !target.classList.contains('hidden');
    edge.classList.toggle('hidden', !show);
    if (show) visibleEdges++;
  }

  const visibleNodes = nodes.filter(n => !n.classList.contains('hidden')).length;
  visibleCount.textContent = ${visibleText}.replace('__NODES__', visibleNodes).replace('__EDGES__', visibleEdges);
}

edgeChecks.forEach(cb => cb.addEventListener('change', applyFilters));
onlyImportant.addEventListener('change', applyFilters);
hideIdle.addEventListener('change', applyFilters);
showLabels.addEventListener('change', () => svg.classList.toggle('labels-off', !showLabels.checked));
q.addEventListener('input', applyFilters);
applyFilters();

function svgPoint(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function setNodePosition(node, x, y) {
  node.dataset.x = String(x);
  node.dataset.y = String(y);
  node.setAttribute('transform', 'translate(' + x + ',' + y + ')');
  updateConnectedEdges(node.dataset.id);
}

function updateConnectedEdges(nodeId) {
  for (const edge of edges) {
    if (edge.dataset.source !== nodeId && edge.dataset.target !== nodeId) continue;
    const source = nodeById.get(edge.dataset.source);
    const target = nodeById.get(edge.dataset.target);
    edge.setAttribute('x1', source.dataset.x);
    edge.setAttribute('y1', source.dataset.y);
    edge.setAttribute('x2', target.dataset.x);
    edge.setAttribute('y2', target.dataset.y);
  }
}

resetLayout.addEventListener('click', () => {
  for (const node of nodes) {
    setNodePosition(node, Number(node.dataset.initialX), Number(node.dataset.initialY));
  }
});

nodes.forEach(node => {
  node.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const point = svgPoint(event);
    dragging = {
      node,
      dx: point.x - Number(node.dataset.x),
      dy: point.y - Number(node.dataset.y),
    };
    node.classList.add('dragging');
    if (node.setPointerCapture) node.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
});

svg.addEventListener('pointermove', event => {
  if (!dragging) return;
  const point = svgPoint(event);
  setNodePosition(dragging.node, point.x - dragging.dx, point.y - dragging.dy);
});

svg.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging.node.classList.remove('dragging');
  dragging = null;
});

svg.addEventListener('pointercancel', () => {
  if (!dragging) return;
  dragging.node.classList.remove('dragging');
  dragging = null;
});
</script>
</body>
</html>`;
}

function layoutGraph(graph) {
  const map = new Map();
  const skillCount = graph.nodes.filter((n) => n.type === 'skill').length;
  const width = Math.min(3600, Math.max(1600, Math.ceil(Math.sqrt(Math.max(1, skillCount)) * 260)));
  const height = Math.min(2600, Math.max(1100, Math.ceil(width * 0.68)));
  const cx = width / 2;
  const cy = height / 2;
  const base = Math.min(width, height);
  const categories = graph.nodes.filter((n) => n.type === 'category').sort((a, b) => a.label.localeCompare(b.label));
  const angleForCategory = new Map();
  categories.forEach((c, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(1, categories.length) - Math.PI / 2;
    angleForCategory.set(c.label, angle);
    map.set(c.id, { x: cx + Math.cos(angle) * (base * 0.24), y: cy + Math.sin(angle) * (base * 0.24) });
  });
  const skillsByCat = groupBy(graph.nodes.filter((n) => n.type === 'skill'), (n) => n.category || '未分类');
  for (const [category, list] of skillsByCat) {
    const base = angleForCategory.get(category) ?? 0;
    list.sort((a, b) => b.usageCount - a.usageCount || a.label.localeCompare(b.label));
    const perRing = Math.max(7, Math.ceil(Math.sqrt(list.length) * 2.6));
    const spread = Math.min(1.05, 0.28 + list.length * 0.018);
    list.forEach((n, i) => {
      const ring = Math.min(width, height) * 0.36 + Math.floor(i / perRing) * 74;
      const slot = i % perRing;
      const offset = (slot - (perRing - 1) / 2) * (spread / Math.max(1, perRing - 1));
      const angle = base + offset;
      map.set(n.id, { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring });
    });
  }
  const placeRing = (type, radius, start = 0) => {
    const list = graph.nodes.filter((n) => n.type === type).sort((a, b) => a.label.localeCompare(b.label));
    list.forEach((n, i) => {
      const angle = start + (Math.PI * 2 * i) / Math.max(1, list.length);
      map.set(n.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    });
  };
  placeRing('family', base * 0.17, Math.PI / 12);
  placeRing('platform', base * 0.105, Math.PI / 6);
  placeRing('mcp', base * 0.055, 0);
  return { positions: map, width, height };
}

function resolveFormat({ format, output, json }) {
  if (json) return 'json';
  if (format) return format;
  if (output) {
    const ext = path.extname(output).toLowerCase();
    if (ext === '.html' || ext === '.htm') return 'html';
    if (ext === '.json') return 'json';
    if (ext === '.md' || ext === '.mmd') return 'mermaid';
  }
  return 'summary';
}

function writeTextFile(file, text) {
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, text);
}

function familyOf(name) {
  const parts = String(name).split('-');
  return parts.length > 1 ? parts[0] : '';
}

function detectPlatforms(skill) {
  const text = `${skill.dirName} ${skill.name} ${skill.description}`.toLowerCase();
  return PLATFORM_RULES
    .filter(([, words]) => words.some((w) => text.includes(w.toLowerCase())))
    .map(([name]) => name);
}

function detectTransforms(skill) {
  const text = `${skill.dirName} ${skill.description || ''}`.toLowerCase();
  const transforms = [];
  const name = skill.dirName.toLowerCase();
  if (name.includes('-to-')) {
    const [before, after] = name.split('-to-');
    transforms.push({
      from: normalizeTransformTerm(before.split('-').pop()),
      to: normalizeTransformTerm(after.split('-')[0]),
      confidenceScore: 2,
      source: 'dirName',
    });
  }
  const re = /\b(markdown|md|html|url|web|image|png|svg|ppt|slides?|pdf|json)\s+(?:to|转成|转为|转换为)\s+(markdown|md|html|url|web|image|png|svg|ppt|slides?|pdf|json)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    transforms.push({
      from: normalizeTransformTerm(m[1]),
      to: normalizeTransformTerm(m[2]),
      confidenceScore: 1,
      source: 'description',
    });
  }
  return uniqueTransforms(transforms.filter((t) => t.from && t.to && t.from !== t.to));
}

function normalizeTransformTerm(term) {
  const clean = String(term || '').replace(/s$/, '');
  return TRANSFORM_ALIASES.get(clean) || clean;
}

function uniqueTransforms(transforms) {
  const seen = new Set();
  const out = [];
  for (const t of transforms) {
    const key = `${t.from}->${t.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function skillId(name) {
  return `skill:${name}`;
}

function mcpId(name) {
  return `mcp:${name}`;
}

function familyId(name) {
  return `family:${name}`;
}

function categoryId(name) {
  return `category:${name}`;
}

function platformId(name) {
  return `platform:${name}`;
}

function mermaidId(id) {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

function escapeMermaid(s) {
  return String(s).replace(/"/g, '\\"');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nodeRadius(n) {
  if (n.type === 'skill') return Math.min(18, 7 + Math.log2((n.usageCount || 0) + 1) * 2.2);
  if (n.type === 'mcp') return 13;
  if (n.type === 'category') return 18;
  if (n.type === 'family') return 14;
  return 11;
}

function nodeColor(n) {
  if (n.type === 'category') return '#2563eb';
  if (n.type === 'family') return '#7c3aed';
  if (n.type === 'platform') return '#0f766e';
  if (n.type === 'mcp') return '#be185d';
  const colors = ['#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#22d3ee', '#f97316', '#84cc16'];
  let hash = 0;
  for (const ch of String(n.category || n.label)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function nodeStroke(n) {
  if (n.duplicateEntity) return '#ef4444';
  if (n.tools?.length > 1) return '#f8fafc';
  return '#0f172a';
}

function edgeWidth(e) {
  if (e.type === 'duplicate') return 2.4;
  if (e.type === 'pipeline') return 2;
  return 1.2;
}

function graphDegrees(edges) {
  const degrees = new Map();
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1);
  }
  return degrees;
}

function isImportantNode(n, degree) {
  if (n.type !== 'skill') return true;
  return Boolean(n.duplicateEntity || n.usageCount > 0 || degree >= 3);
}

function nodeSearchText(n) {
  return [
    n.id,
    n.label,
    n.type,
    n.category,
    n.toolLabel,
    n.family,
    ...(n.platforms || []),
    n.description,
  ].filter(Boolean).join(' ').toLowerCase();
}

function nodeTitle(n, lang = 'zh-CN') {
  const parts = [
    `${n.label} (${n.type})`,
    n.category ? `${tr(lang, 'graph.node.category')}：${n.category}` : '',
    n.tools?.length ? `${tr(lang, 'graph.node.tool')}：${localizedToolLabel(n.tools, lang)}` : '',
    n.usageCount != null ? tr(lang, 'graph.node.usage', { count: n.usageCount, ago: fmtAgoLang(lang, n.lastUsed) }) : '',
    n.duplicateEntity ? tr(lang, 'graph.node.duplicate') : '',
    n.description ? `${tr(lang, 'graph.node.description')}：${n.description}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

function edgeLabel(type, lang = 'zh-CN') {
  return (lang === 'en' ? EDGE_LABELS_EN : EDGE_LABELS)[type] || type;
}

function edgeDescription(type, lang = 'zh-CN') {
  return (lang === 'en' ? EDGE_DESCRIPTIONS_EN : EDGE_DESCRIPTIONS)[type];
}

function localizedToolLabel(tools, lang) {
  const label = toolLabel(tools);
  return label === '两侧' ? tr(lang, 'tool.both') : label;
}

function shortLabel(s, max) {
  const text = String(s);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
