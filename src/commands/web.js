import http from 'node:http';
import { URL } from 'node:url';
import { mergeByDirName } from '../catalog.js';
import { buildOverview } from '../overview.js';
import { buildSessionIndex } from '../sessionsIndex.js';
import { buildUsageLookup, scanUsage } from '../usage.js';
import { paint } from '../utils.js';
import { runScan, ensureCatalog } from './scan.js';
import { buildKnowledgeGraph } from './graph.js';
import { buildReportData } from './report.js';
import { rankRecommendations } from './recommend.js';

const DEFAULT_PORT = 17361;
const HOST = '127.0.0.1';

export function runWeb(ctx) {
  const lang = ctx.lang || 'zh-CN';
  const port = parsePort(ctx.port, lang);
  if (port == null) return;
  const server = createWebServer({ cwd: ctx.cwd, lang, port });
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}`;
    console.log(paint.green(zh(lang, `skm Web 工作台已启动：${url}`, `skm Web dashboard is running: ${url}`)));
    console.log(zh(lang, '第一阶段为本地只读工作台；关闭终端进程即可停止服务。', 'Phase 1 is a local read-only dashboard; stop the terminal process to shut it down.'));
  });
  server.on('error', (e) => {
    console.error(zh(lang, `Web 服务启动失败：${e.message}`, `Failed to start the web server: ${e.message}`));
    process.exitCode = 1;
  });
}

export function createWebServer({ cwd, lang = 'zh-CN', port = DEFAULT_PORT }) {
  return http.createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host, port)) return sendJson(res, 403, { error: 'forbidden_host' });
      const url = new URL(req.url || '/', `http://${HOST}`);
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
      if (url.pathname.startsWith('/api/') && !isAllowedApiRequest(req, port)) return sendJson(res, 403, { error: 'forbidden_origin' });
      if (url.pathname === '/') return sendHtml(res, renderWebHtml(lang));
      if (url.pathname === '/api/dashboard') return sendJson(res, 200, collectDashboard({ cwd, lang, refresh: url.searchParams.get('refresh') === '1' }));
      if (url.pathname === '/api/recommend') return sendJson(res, 200, collectRecommendation({ cwd, lang, query: url.searchParams.get('q') || '', top: url.searchParams.get('top') || '5' }));
      return sendJson(res, 404, { error: 'not_found' });
    } catch (e) {
      sendJson(res, 500, { error: 'internal_error', message: e.message || String(e) });
    }
  });
}

export function isAllowedHost(host, port = DEFAULT_PORT) {
  if (!host) return false;
  const allowed = new Set([
    '127.0.0.1',
    `127.0.0.1:${port}`,
    'localhost',
    `localhost:${port}`,
    '[::1]',
    `[::1]:${port}`,
  ]);
  return allowed.has(String(host).toLowerCase());
}

function isAllowedApiRequest(req, port) {
  if (!isAllowedOrigin(req.headers.origin, port)) return false;
  const fetchSite = req.headers['sec-fetch-site'];
  if (!fetchSite) return true;
  return ['same-origin', 'same-site', 'none'].includes(String(fetchSite).toLowerCase());
}

export function isAllowedOrigin(origin, port = DEFAULT_PORT) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return false;
    const originPort = url.port ? Number(url.port) : 80;
    return originPort === Number(port);
  } catch {
    return false;
  }
}

export function collectDashboard({ cwd, lang = 'zh-CN', refresh = false }) {
  if (refresh) runScan({ cwd, silent: true, quiet: true, lang });
  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(catalog.skills || []);
  const usage = scanUsage({ log: () => {}, lang });
  const usageOf = buildUsageLookup(merged, usage);
  const sessions = buildSessionIndex();
  const overview = buildOverview({ catalog, usage, sessions, lang });
  const report = buildReportData({ catalog, merged, usage, sessions, lang });
  const graph = buildKnowledgeGraph(catalog, usage);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    cwd,
    catalog: {
      scannedAt: catalog.scannedAt || null,
      warnings: (catalog.warnings || []).length,
      archived: catalog.archived || {},
      security: catalog.security?.summary || { high: 0, medium: 0, low: 0, info: 0, total: 0 },
    },
    overview,
    report,
    tools: summarizeTools(catalog),
    categories: summarizeCategories(merged),
    skills: merged
      .map((skill) => {
        const u = usageOf(skill);
        return {
          name: skill.dirName,
          title: skill.name || skill.dirName,
          category: skill.category,
          tools: skill.tools || [],
          installs: (skill.entries || [skill]).length,
          description: skill.description || '',
          descTokens: skill.descTokens || 0,
          usageCount: u.count,
          lastUsed: u.lastUsed || null,
          hasSource: Boolean((skill.entries || [skill]).some((entry) => entry.upstream?.trackable || entry.upstream?.source || entry.upstream?.repository || entry.upstream?.homepage)),
        };
      })
      .sort((a, b) => b.usageCount - a.usageCount || b.descTokens - a.descTokens || a.name.localeCompare(b.name)),
    mcpServers: (catalog.mcpServers || []).map((server) => ({
      name: server.name,
      tool: server.tool,
      scope: server.scope,
      transport: server.transport,
      schemaTokens: server.schemaTokens || 0,
    })),
    graphPreview: graphPreview(graph),
    commands: commandCatalog(lang),
  };
}

function collectRecommendation({ cwd, lang, query, top }) {
  const text = String(query || '').trim();
  if (!text) return { query: text, items: [] };
  const limit = Math.max(1, Math.min(10, Number.parseInt(top, 10) || 5));
  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(catalog.skills || []);
  const usage = scanUsage({ log: () => {}, lang });
  const usageOf = buildUsageLookup(merged, usage);
  const items = rankRecommendations(merged, text, usageOf).slice(0, limit).map((row) => ({
    name: row.skill.dirName,
    category: row.skill.category,
    tools: row.skill.tools || [],
    score: row.score,
    usageCount: row.usage.count,
    lastUsed: row.usage.lastUsed || null,
    reasons: row.reasons || [],
    description: row.skill.description || '',
  }));
  return { query: text, items };
}

function summarizeTools(catalog) {
  const tools = ['claude-code', 'codex', 'cursor', 'gemini'];
  return tools.map((tool) => {
    const skills = (catalog.skills || []).filter((item) => item.tool === tool);
    return {
      tool,
      skills: skills.length,
      user: skills.filter((item) => item.scope === 'user').length,
      project: skills.filter((item) => item.scope === 'project').length,
      plugin: skills.filter((item) => item.scope === 'plugin').length,
      mcp: (catalog.mcpServers || []).filter((item) => item.tool === tool).length,
    };
  });
}

function summarizeCategories(skills) {
  const counts = new Map();
  for (const skill of skills) counts.set(skill.category || '未分类', (counts.get(skill.category || '未分类') || 0) + 1);
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function graphPreview(graph) {
  const important = [...graph.nodes]
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || String(a.label).localeCompare(String(b.label)))
    .slice(0, 72);
  const ids = new Set(important.map((node) => node.id));
  return {
    stats: graph.stats,
    nodes: important.map((node) => ({ id: node.id, label: node.label, type: node.type, category: node.category || '', usageCount: node.usageCount || 0 })),
    edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).slice(0, 140).map((edge) => ({ source: edge.source, target: edge.target, type: edge.type, label: edge.label })),
  };
}

function commandCatalog(lang) {
  const rows = [
    ['scan', 'skm scan', zh(lang, '刷新事实清单并展示治理总览', 'Refresh inventory facts and show the governance overview'), 'read'],
    ['status', 'skm', zh(lang, '查看总分结构治理总览', 'Show the grouped governance overview'), 'read'],
    ['list', 'skm list', zh(lang, '按分类查看所有 skill', 'List all skills by category'), 'read'],
    ['search', 'skm search <关键词>', zh(lang, '按名称、分类和描述搜索 skill', 'Search skills by name, category, and description'), 'read'],
    ['recommend', 'skm ask "任务"', zh(lang, '按自然语言任务推荐 skill', 'Recommend skills for a natural-language task'), 'read'],
    ['risks', 'skm risks', zh(lang, '查看重复、闲置、上下文和日志风险', 'Inspect duplicate, idle, context, and log risks'), 'read'],
    ['audit', 'skm audit', zh(lang, '审计真实使用频率和静态安全发现', 'Audit usage frequency and static safety findings'), 'read'],
    ['outdated', 'skm outdated --online', zh(lang, '联网检查上游版本线索', 'Check upstream freshness online'), 'read'],
    ['sources', 'skm sources missing', zh(lang, '列出缺少上游来源的 skill', 'List skills missing upstream sources'), 'read'],
    ['state', 'skm state plan', zh(lang, '生成只读降载治理计划', 'Generate a read-only state governance plan'), 'read'],
    ['lock', 'skm lock diff / skm lock verify', zh(lang, '对比或校验生命周期基线', 'Compare or verify lifecycle baselines'), 'read'],
    ['policy', 'skm policy check', zh(lang, '检查生命周期治理策略', 'Check lifecycle governance policy'), 'read'],
    ['eval', 'skm eval --all', zh(lang, '评测 skill 质量和整理优先级', 'Evaluate skill quality and cleanup priority'), 'read'],
    ['graph', 'skm graph --format html --output skill-graph.html', zh(lang, '导出完整知识图谱', 'Export the full knowledge graph'), 'read'],
    ['report', 'skm report --format html --output skm-report.html', zh(lang, '导出一页式 HTML 报告', 'Export a one-page HTML report'), 'read'],
    ['sessions', 'skm sessions', zh(lang, '查看会话日志分布', 'Show session log distribution'), 'read'],
    ['doctor', 'skm doctor', zh(lang, '诊断环境和本机依赖状态', 'Diagnose environment and local prerequisites'), 'read'],
    ['install', 'skm install <源> --dry-run', zh(lang, '预览 skill 安装计划', 'Preview a skill install plan'), 'dry-run'],
    ['update', 'skm update <skill> --dry-run', zh(lang, '预览 skill 更新计划', 'Preview a skill update plan'), 'dry-run'],
    ['rollback', 'skm rollback <skill> --dry-run', zh(lang, '预览 skill 回滚计划', 'Preview a skill rollback plan'), 'dry-run'],
    ['disable', 'skm disable <skill> --dry-run', zh(lang, '预览软禁用操作', 'Preview a soft-disable action'), 'dry-run'],
    ['enable', 'skm enable', zh(lang, '查看可恢复的禁用项', 'List restorable disabled items'), 'read'],
  ];
  return rows.map(([id, command, description, mode]) => ({ id, command, description, mode }));
}

function parsePort(value, lang) {
  if (value == null) return DEFAULT_PORT;
  if (!/^\d+$/.test(String(value))) {
    console.error(zh(lang, `--port 必须是 1-65535 的整数，收到：${value}`, `--port must be an integer from 1 to 65535, received: ${value}`));
    process.exitCode = 1;
    return null;
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    console.error(zh(lang, `--port 超出范围：${value}`, `--port is out of range: ${value}`));
    process.exitCode = 1;
    return null;
  }
  return port;
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(html);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data, null, 2));
}

export function renderWebHtml(lang = 'zh-CN') {
  const labels = webLabels(lang);
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(labels.title)}</title>
<style>
:root {
  color-scheme: dark;
  --bg:#050510; --panel:rgba(10,16,35,.72); --panel-strong:rgba(16,24,48,.9); --text:#f7fbff; --muted:#9fb4d1;
  --line:rgba(125,249,255,.25); --accent:#00f5ff; --accent-2:#ff2bd6; --accent-3:#f9f871; --good:#2df59f; --warn:#ffd166; --bad:#ff4d6d;
  --shadow:0 24px 90px rgba(0,245,255,.16); --grid:rgba(0,245,255,.08); --hero:radial-gradient(circle at 18% 12%, rgba(255,43,214,.24), transparent 30%), radial-gradient(circle at 78% 20%, rgba(0,245,255,.24), transparent 34%), linear-gradient(135deg, #09071c, #071629 58%, #1b0730);
}
body[data-theme="galaxy"] {
  --bg:#030617; --panel:rgba(12,18,43,.72); --panel-strong:rgba(17,24,55,.9); --text:#f7f3ff; --muted:#b8b7df;
  --line:rgba(168,85,247,.28); --accent:#a78bfa; --accent-2:#38bdf8; --accent-3:#f0abfc; --shadow:0 24px 90px rgba(167,139,250,.18); --grid:rgba(167,139,250,.08);
  --hero:radial-gradient(circle at 18% 16%, rgba(56,189,248,.28), transparent 32%), radial-gradient(circle at 74% 16%, rgba(240,171,252,.28), transparent 34%), radial-gradient(circle at 52% 70%, rgba(167,139,250,.24), transparent 38%), linear-gradient(135deg, #020617, #111827 58%, #241049);
}
body[data-theme="sky"] {
  color-scheme: light;
  --bg:#eaf7ff; --panel:rgba(255,255,255,.72); --panel-strong:rgba(255,255,255,.9); --text:#0f172a; --muted:#52657b;
  --line:rgba(14,116,144,.18); --accent:#0284c7; --accent-2:#22c55e; --accent-3:#f59e0b; --shadow:0 24px 90px rgba(2,132,199,.18); --grid:rgba(2,132,199,.1);
  --hero:radial-gradient(circle at 18% 16%, rgba(125,211,252,.65), transparent 34%), radial-gradient(circle at 82% 14%, rgba(255,255,255,.78), transparent 32%), linear-gradient(135deg, #dff6ff, #f8fdff 55%, #b8e8ff);
}
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--text); background:var(--bg); letter-spacing:0; overflow-x:hidden; }
body::before { content:""; position:fixed; inset:0; pointer-events:none; background-image:linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size:34px 34px; mask-image:linear-gradient(to bottom, #000, transparent 76%); }
button, input { font:inherit; }
button { border:0; cursor:pointer; color:var(--text); }
.shell { position:relative; z-index:1; min-height:100vh; }
.topbar { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:18px clamp(16px,3vw,34px); position:sticky; top:0; backdrop-filter:blur(18px); background:color-mix(in srgb, var(--bg) 72%, transparent); border-bottom:1px solid var(--line); z-index:5; }
.brand { display:flex; align-items:center; gap:12px; min-width:0; }
.mark { width:38px; height:38px; border-radius:12px; background:linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow:0 0 28px color-mix(in srgb, var(--accent) 48%, transparent); display:grid; place-items:center; font-weight:900; color:#020617; }
.brand h1 { margin:0; font-size:18px; line-height:1; }
.brand p { margin:5px 0 0; color:var(--muted); font-size:12px; }
.controls { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
.theme-btn, .action-btn { height:34px; border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:0 11px; box-shadow:0 10px 26px rgba(0,0,0,.1); }
.theme-btn.active { background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 34%, transparent), color-mix(in srgb, var(--accent-2) 24%, transparent)); border-color:var(--accent); }
.action-btn.primary { color:#06111f; background:linear-gradient(135deg, var(--accent), var(--accent-3)); font-weight:760; }
.hero { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr); gap:18px; padding:28px clamp(16px,3vw,34px) 16px; }
.hero-main { position:relative; min-height:330px; border:1px solid var(--line); border-radius:18px; background:var(--hero); box-shadow:var(--shadow); overflow:hidden; padding:30px; }
.hero-main::after { content:""; position:absolute; inset:0; background:linear-gradient(115deg, transparent 0 38%, color-mix(in srgb, var(--accent) 18%, transparent) 48%, transparent 58%); animation:sweep 6s linear infinite; }
.hero-copy { position:relative; z-index:1; max-width:780px; }
.eyebrow { color:var(--accent-3); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; }
.hero h2 { margin:12px 0 12px; font-size:clamp(36px,5vw,70px); line-height:.96; letter-spacing:0; max-width:920px; overflow-wrap:anywhere; }
.hero p { color:var(--muted); max-width:680px; line-height:1.68; margin:0; overflow-wrap:anywhere; }
.terminal { margin-top:26px; width:min(640px, 100%); border:1px solid var(--line); border-radius:12px; background:rgba(0,0,0,.36); overflow:hidden; }
body[data-theme="sky"] .terminal { background:rgba(255,255,255,.58); }
.dots { display:flex; gap:6px; padding:10px 12px; border-bottom:1px solid var(--line); }
.dots span { width:9px; height:9px; border-radius:99px; background:var(--accent); box-shadow:0 0 12px var(--accent); }
.terminal pre { margin:0; padding:14px; color:var(--text); overflow:auto; font-size:13px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }
.loader-card { border:1px solid var(--line); border-radius:18px; background:var(--panel); box-shadow:var(--shadow); padding:18px; display:grid; align-content:center; min-height:330px; overflow:hidden; }
.loader-scene { height:220px; display:grid; place-items:center; perspective:900px; position:relative; }
.cube { position:relative; width:86px; height:86px; transform-style:preserve-3d; animation:cubeSpin 2.6s linear infinite; }
.face { position:absolute; inset:0; display:grid; place-items:center; border:1px solid color-mix(in srgb, var(--accent) 62%, white 8%); background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent-2) 24%, transparent)); box-shadow:inset 0 0 26px color-mix(in srgb, var(--accent) 28%, transparent), 0 0 24px color-mix(in srgb, var(--accent) 26%, transparent); font-size:11px; font-weight:900; color:var(--text); }
.f1 { transform:translateZ(43px); } .f2 { transform:rotateY(90deg) translateZ(43px); } .f3 { transform:rotateY(180deg) translateZ(43px); } .f4 { transform:rotateY(-90deg) translateZ(43px); } .f5 { transform:rotateX(90deg) translateZ(43px); } .f6 { transform:rotateX(-90deg) translateZ(43px); }
.orbit { position:absolute; width:170px; height:170px; border:1px solid color-mix(in srgb, var(--accent) 38%, transparent); border-radius:50%; transform-style:preserve-3d; animation:orbit 3.8s linear infinite; }
.orbit:nth-child(2) { transform:rotateX(70deg); animation-duration:4.8s; border-color:color-mix(in srgb, var(--accent-2) 42%, transparent); }
.loader-card h3 { margin:8px 0 6px; font-size:18px; }
.loader-card p { margin:0; color:var(--muted); line-height:1.6; }
.layout { display:grid; grid-template-columns:230px minmax(0,1fr); gap:18px; padding:14px clamp(16px,3vw,34px) 34px; align-items:start; }
.rail { position:sticky; top:84px; display:grid; gap:8px; border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:10px; box-shadow:var(--shadow); }
.rail a { color:var(--muted); text-decoration:none; padding:10px 11px; border-radius:8px; font-size:13px; }
.rail a:hover { color:var(--text); background:color-mix(in srgb, var(--accent) 12%, transparent); }
.content { display:grid; gap:18px; }
.grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.card { border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:16px; box-shadow:0 14px 42px rgba(0,0,0,.12); min-width:0; }
.card h3 { margin:0 0 12px; font-size:16px; }
.metric b { display:block; font-size:30px; line-height:1; }
.metric span { color:var(--muted); font-size:12px; }
.wide { grid-column:span 2; } .full { grid-column:1 / -1; }
.section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:12px; }
.section-head p { margin:4px 0 0; color:var(--muted); font-size:13px; }
.table-wrap { overflow:auto; border:1px solid var(--line); border-radius:10px; }
table { width:100%; border-collapse:collapse; min-width:720px; }
th, td { text-align:left; padding:10px 11px; border-bottom:1px solid var(--line); vertical-align:top; font-size:13px; }
th { color:var(--muted); font-weight:760; background:color-mix(in srgb, var(--panel-strong) 86%, transparent); }
tr:last-child td { border-bottom:0; }
.pill { display:inline-flex; align-items:center; gap:5px; min-height:22px; padding:2px 8px; border-radius:999px; background:color-mix(in srgb, var(--accent) 14%, transparent); color:var(--text); border:1px solid color-mix(in srgb, var(--accent) 24%, transparent); font-size:12px; margin:2px 3px 2px 0; }
.pill.warn { background:color-mix(in srgb, var(--warn) 18%, transparent); border-color:color-mix(in srgb, var(--warn) 30%, transparent); }
.pill.dry { background:color-mix(in srgb, var(--accent-3) 20%, transparent); border-color:color-mix(in srgb, var(--accent-3) 34%, transparent); }
.domains { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.domain { min-height:142px; display:flex; flex-direction:column; gap:10px; }
.domain strong { font-size:15px; }
.domain p { margin:0; color:var(--muted); line-height:1.52; font-size:13px; }
.cmd { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color:var(--accent-3); font-size:12px; word-break:break-all; }
.searchbar { display:flex; gap:10px; flex-wrap:wrap; }
.searchbar input { flex:1; min-width:220px; height:38px; padding:0 12px; border-radius:9px; border:1px solid var(--line); background:var(--panel-strong); color:var(--text); outline:none; }
.graph-box { width:100%; height:420px; border:1px solid var(--line); border-radius:12px; background:radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 52%); overflow:hidden; }
.graph-box svg { width:100%; height:100%; display:block; }
.node { fill:var(--panel-strong); stroke:var(--accent); stroke-width:1.4; filter:drop-shadow(0 0 8px color-mix(in srgb, var(--accent) 50%, transparent)); }
.node.mcp { stroke:var(--accent-2); }
.edge { stroke:color-mix(in srgb, var(--accent) 36%, transparent); stroke-width:1; }
.graph-label { fill:var(--text); font-size:10px; paint-order:stroke; stroke:var(--bg); stroke-width:3px; }
.toast { position:fixed; right:18px; bottom:18px; z-index:20; border:1px solid var(--line); background:var(--panel-strong); color:var(--text); padding:10px 12px; border-radius:10px; box-shadow:var(--shadow); opacity:0; transform:translateY(10px); transition:.22s ease; }
.toast.show { opacity:1; transform:translateY(0); }
.hidden { display:none !important; }
@keyframes cubeSpin { from { transform:rotateX(-22deg) rotateY(0deg) rotateZ(0deg); } to { transform:rotateX(338deg) rotateY(360deg) rotateZ(360deg); } }
@keyframes orbit { from { transform:rotateX(64deg) rotateZ(0deg); } to { transform:rotateX(64deg) rotateZ(360deg); } }
@keyframes sweep { from { transform:translateX(-90%); } to { transform:translateX(90%); } }
@media (max-width:1040px) { .hero { grid-template-columns:1fr; } .layout { grid-template-columns:1fr; } .rail { position:relative; top:auto; display:flex; overflow:auto; } .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:680px) { .shell, .topbar, .hero, .layout, .content, .card { max-width:100vw; min-width:0; } .topbar { align-items:flex-start; flex-direction:column; overflow:hidden; } .controls { width:100%; min-width:0; display:grid; grid-template-columns:1fr; gap:8px; } .theme-btn, .action-btn { width:100%; min-width:0; padding:0 6px; font-size:14px; } .hero { grid-template-columns:minmax(0,1fr); overflow:hidden; } .hero-main { padding:22px; min-width:0; } .grid, .domains { grid-template-columns:1fr; } .wide { grid-column:1 / -1; } .hero h2 { font-size:34px; line-height:1.04; word-break:break-all; } }
</style>
</head>
<body data-theme="cyberpunk">
<div class="shell">
  <header class="topbar">
    <div class="brand"><div class="mark">SKM</div><div><h1>${escapeHtml(labels.title)}</h1><p>${escapeHtml(labels.subtitle)}</p></div></div>
    <div class="controls">
      <button class="theme-btn active" data-theme-target="cyberpunk">${escapeHtml(labels.cyberpunk)}</button>
      <button class="theme-btn" data-theme-target="galaxy">${escapeHtml(labels.galaxy)}</button>
      <button class="theme-btn" data-theme-target="sky">${escapeHtml(labels.sky)}</button>
      <button class="action-btn primary" id="refresh-btn">${escapeHtml(labels.refresh)}</button>
    </div>
  </header>
  <section class="hero">
    <div class="hero-main">
      <div class="hero-copy">
        <div class="eyebrow">${escapeHtml(labels.eyebrow)}</div>
        <h2>${escapeHtml(labels.heroTitle)}</h2>
        <p>${escapeHtml(labels.heroText)}</p>
        <div class="terminal"><div class="dots"><span></span><span></span><span></span></div><pre id="terminal-lines">$ skm web
> ${escapeHtml(labels.loading)}
> ${escapeHtml(labels.localOnly)}</pre></div>
      </div>
    </div>
    <aside class="loader-card" aria-live="polite">
      <div class="loader-scene">
        <div class="orbit"></div><div class="orbit"></div>
        <div class="cube" aria-label="${escapeHtml(labels.loading)}">
          <div class="face f1">SCAN</div><div class="face f2">RISK</div><div class="face f3">LOCK</div>
          <div class="face f4">MCP</div><div class="face f5">SKILL</div><div class="face f6">GRAPH</div>
        </div>
      </div>
      <h3 id="loader-title">${escapeHtml(labels.loadingTitle)}</h3>
      <p id="loader-text">${escapeHtml(labels.loadingText)}</p>
    </aside>
  </section>
  <div class="layout">
    <nav class="rail">
      <a href="#overview">${escapeHtml(labels.navOverview)}</a>
      <a href="#domains">${escapeHtml(labels.navDomains)}</a>
      <a href="#skills">${escapeHtml(labels.navSkills)}</a>
      <a href="#graph">${escapeHtml(labels.navGraph)}</a>
      <a href="#recommend">${escapeHtml(labels.navRecommend)}</a>
      <a href="#commands">${escapeHtml(labels.navCommands)}</a>
    </nav>
    <main class="content">
      <section id="overview" class="grid"></section>
      <section id="domains" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navDomains)}</h3><p>${escapeHtml(labels.domainHint)}</p></div></div><div class="domains" id="domain-list"></div></section>
      <section id="skills" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navSkills)}</h3><p>${escapeHtml(labels.skillHint)}</p></div><div class="searchbar"><input id="skill-filter" placeholder="${escapeHtml(labels.filterPlaceholder)}"></div></div><div class="table-wrap"><table><thead><tr><th>${escapeHtml(labels.name)}</th><th>${escapeHtml(labels.category)}</th><th>${escapeHtml(labels.tools)}</th><th>${escapeHtml(labels.usage)}</th><th>${escapeHtml(labels.context)}</th><th>${escapeHtml(labels.source)}</th></tr></thead><tbody id="skill-rows"></tbody></table></div></section>
      <section id="graph" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navGraph)}</h3><p>${escapeHtml(labels.graphHint)}</p></div></div><div class="graph-box" id="graph-box"></div></section>
      <section id="recommend" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navRecommend)}</h3><p>${escapeHtml(labels.recommendHint)}</p></div></div><div class="searchbar"><input id="recommend-input" placeholder="${escapeHtml(labels.recommendPlaceholder)}"><button class="action-btn primary" id="recommend-btn">${escapeHtml(labels.recommendButton)}</button></div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>${escapeHtml(labels.name)}</th><th>${escapeHtml(labels.category)}</th><th>${escapeHtml(labels.score)}</th><th>${escapeHtml(labels.reason)}</th></tr></thead><tbody id="recommend-rows"></tbody></table></div></section>
      <section id="commands" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navCommands)}</h3><p>${escapeHtml(labels.commandHint)}</p></div></div><div class="domains" id="command-list"></div></section>
    </main>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
const labels = ${JSON.stringify(labels)};
const state = { data: null, skillFilter: '' };
const $ = (id) => document.getElementById(id);
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function fmt(value) { return value == null ? '—' : String(value); }
function fmtDate(value) { if (!value) return '—'; try { return new Date(value).toLocaleString(); } catch { return '—'; } }
function pill(text, cls = '') { return '<span class="pill ' + cls + '">' + esc(text) + '</span>'; }
function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem('skm-web-theme', theme);
  document.querySelectorAll('.theme-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.themeTarget === theme));
}
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(labels.copied); } catch { toast(text); }
}
async function loadDashboard(refresh = false) {
  $('loader-title').textContent = refresh ? labels.refreshingTitle : labels.loadingTitle;
  $('loader-text').textContent = refresh ? labels.refreshingText : labels.loadingText;
  const res = await fetch('/api/dashboard' + (refresh ? '?refresh=1' : ''));
  if (!res.ok) throw new Error(await res.text());
  state.data = await res.json();
  renderAll();
}
function renderAll() {
  renderTerminal();
  renderMetrics();
  renderDomains();
  renderSkills();
  renderGraph();
  renderCommands();
}
function renderTerminal() {
  const d = state.data;
  $('terminal-lines').textContent = '$ skm web\\n> score ' + d.overview.score + '/100 · skills ' + d.overview.skills + ' · MCP ' + d.overview.mcpServers + '\\n> catalog ' + fmtDate(d.catalog.scannedAt) + '\\n> ' + labels.localOnly;
}
function metric(title, value, note, cls = '') {
  return '<article class="card metric"><b class="' + cls + '">' + esc(value) + '</b><span>' + esc(title) + '</span><p style="color:var(--muted);font-size:12px;line-height:1.5;margin:8px 0 0">' + esc(note || '') + '</p></article>';
}
function renderMetrics() {
  const d = state.data;
  const h = d.report.health;
  $('overview').innerHTML = [
    metric(labels.healthScore, d.overview.score + ' / 100', labels.scoreNote, d.overview.score >= 80 ? 'good' : d.overview.score >= 60 ? 'warn' : 'bad'),
    metric('Skill', d.overview.skills, labels.skillMetric),
    metric('MCP', d.overview.mcpServers, labels.mcpMetric),
    metric(labels.neverUsed, h.neverUsed, labels.neverUsedNote),
    metric(labels.duplicates, h.duplicateInstalls, labels.duplicateNote),
    metric(labels.sessionBytes, bytes(h.sessionBytes), labels.sessionNote),
    metric(labels.reclaimable, bytes(h.reclaimableBytes), labels.reclaimNote),
    metric(labels.security, [d.catalog.security.high, d.catalog.security.medium, d.catalog.security.low].join(' / '), labels.securityNote)
  ].join('');
}
function bytes(n) {
  if (!Number.isFinite(n)) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}
function renderDomains() {
  const domains = state.data.overview.domains;
  const names = { inventory:labels.navOverview, risks:labels.risks, usage:labels.usage, state:labels.state, versions:labels.versions, lifecycle:labels.lifecycle, duplicates:labels.duplicates, graph:labels.navGraph, sessions:labels.sessions, recommendation:labels.navRecommend };
  $('domain-list').innerHTML = Object.entries(domains).filter(([, value]) => value && value.commands).map(([key, value]) => {
    const commands = (value.commands || []).filter(Boolean).slice(0, 3).map((cmd) => '<button class="theme-btn" data-copy="' + esc(cmd) + '">' + esc(cmd) + '</button>').join(' ');
    return '<article class="card domain"><strong>' + esc(names[key] || key) + '</strong><p>' + esc(domainSummary(key, value)) + '</p><div>' + commands + '</div></article>';
  }).join('');
}
function domainSummary(key, value) {
  if (key === 'inventory') return 'skill ' + value.skills + ' · MCP ' + value.mcpServers + ' · warnings ' + value.warnings;
  if (key === 'risks') return 'high ' + value.high + ' · medium ' + value.medium + ' · low ' + value.low;
  if (key === 'usage') return labels.neverUsed + ' ' + value.neverUsed + ' · stale ' + value.stale;
  if (key === 'versions') return 'unchecked ' + value.unchecked + ' · unknown ' + value.unknown + ' · missing source ' + value.sourceMissing;
  if (key === 'sessions') return bytes(value.sessionBytes) + ' · workspaces ' + value.workspaces;
  if (key === 'lifecycle') return 'records ' + value.installRecords + ' · lockable ' + value.lockable;
  return Object.entries(value).filter(([, v]) => typeof v === 'number').slice(0, 3).map(([k, v]) => k + ' ' + v).join(' · ') || labels.ready;
}
function renderSkills() {
  const q = state.skillFilter.toLowerCase();
  const rows = state.data.skills.filter((skill) => !q || [skill.name, skill.category, skill.description, ...(skill.tools || [])].join(' ').toLowerCase().includes(q)).slice(0, 220);
  $('skill-rows').innerHTML = rows.map((skill) => '<tr><td><strong>' + esc(skill.name) + '</strong><br><span style="color:var(--muted)">' + esc(skill.description).slice(0, 120) + '</span></td><td>' + esc(skill.category) + '</td><td>' + (skill.tools || []).map((tool) => pill(tool)).join('') + '</td><td>' + esc(skill.usageCount) + '<br><span style="color:var(--muted)">' + esc(fmtDate(skill.lastUsed)) + '</span></td><td>' + esc(skill.descTokens) + ' token</td><td>' + (skill.hasSource ? pill(labels.hasSource) : pill(labels.noSource, 'warn')) + '</td></tr>').join('');
}
function renderGraph() {
  const graph = state.data.graphPreview;
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const width = 980, height = 420, cx = width / 2, cy = height / 2;
  const pos = new Map(nodes.map((node, i) => {
    const ring = i < 12 ? 112 : i < 36 ? 178 : 235;
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    return [node.id, { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring }];
  }));
  const edgeSvg = edges.map((edge) => {
    const a = pos.get(edge.source), b = pos.get(edge.target);
    if (!a || !b) return '';
    return '<line class="edge" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"></line>';
  }).join('');
  const nodeSvg = nodes.map((node) => {
    const p = pos.get(node.id);
    const r = node.type === 'mcp' ? 7 : Math.min(13, 6 + Math.sqrt(node.usageCount || 0));
    return '<g><circle class="node ' + esc(node.type) + '" cx="' + p.x + '" cy="' + p.y + '" r="' + r + '"></circle><text class="graph-label" x="' + (p.x + r + 4) + '" y="' + (p.y + 4) + '">' + esc(node.label).slice(0, 18) + '</text></g>';
  }).join('');
  $('graph-box').innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(labels.navGraph) + '">' + edgeSvg + nodeSvg + '</svg>';
}
function renderCommands() {
  $('command-list').innerHTML = state.data.commands.map((item) => '<article class="card domain"><strong>' + esc(item.id) + ' ' + (item.mode === 'dry-run' ? pill('dry-run', 'dry') : pill('read')) + '</strong><p>' + esc(item.description) + '</p><button class="theme-btn cmd" data-copy="' + esc(item.command) + '">' + esc(item.command) + '</button></article>').join('');
}
async function recommend() {
  const query = $('recommend-input').value.trim();
  if (!query) return toast(labels.needQuery);
  const res = await fetch('/api/recommend?q=' + encodeURIComponent(query) + '&top=6');
  const data = await res.json();
  $('recommend-rows').innerHTML = data.items.map((item) => '<tr><td><strong>' + esc(item.name) + '</strong><br><span style="color:var(--muted)">' + esc(item.description).slice(0, 130) + '</span></td><td>' + esc(item.category) + '<br>' + (item.tools || []).map((tool) => pill(tool)).join('') + '</td><td>' + esc(item.score) + '</td><td>' + esc((item.reasons || []).join(' · ')) + '</td></tr>').join('') || '<tr><td colspan="4">' + esc(labels.noRecommendation) + '</td></tr>';
}
document.addEventListener('click', (event) => {
  const theme = event.target.closest('[data-theme-target]');
  if (theme) setTheme(theme.dataset.themeTarget);
  const copyBtn = event.target.closest('[data-copy]');
  if (copyBtn) copy(copyBtn.dataset.copy);
});
$('refresh-btn').addEventListener('click', () => loadDashboard(true).catch((e) => toast(e.message)));
$('skill-filter').addEventListener('input', (event) => { state.skillFilter = event.target.value; renderSkills(); });
$('recommend-btn').addEventListener('click', () => recommend().catch((e) => toast(e.message)));
$('recommend-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') recommend().catch((e) => toast(e.message)); });
setTheme(localStorage.getItem('skm-web-theme') || 'cyberpunk');
loadDashboard(false).catch((e) => toast(e.message));
</script>
</body>
</html>`;
}

function webLabels(lang) {
  const en = lang === 'en';
  return {
    title: en ? 'skill-manager Web Console' : 'skill-manager Web 工作台',
    subtitle: en ? 'Local read-only AIDE skill governance cockpit' : '本地只读 AIDE skill 治理驾驶舱',
    eyebrow: en ? 'VibeCoding control plane' : 'VibeCoding 控制平面',
    heroTitle: en ? 'Skill lifecycle cockpit.' : 'skill 生命周期治理驾驶舱。',
    heroText: en ? 'Inventory, risks, usage, lifecycle baselines, knowledge graph, and next commands are gathered into one local page.' : '清单、风险、使用频率、生命周期基线、知识图谱和下一步命令，集中到一个本地页面里。',
    cyberpunk: en ? 'Cyberpunk' : '赛博朋克',
    galaxy: en ? 'Galaxy' : '宇宙星系',
    sky: en ? 'Sky' : '蓝天白云',
    refresh: en ? 'Refresh Scan' : '刷新扫描',
    loading: en ? 'Loading local governance data' : '正在读取本机治理数据',
    loadingTitle: en ? '3D scan core warming up' : '3D 扫描核心正在预热',
    loadingText: en ? 'Reading catalog, usage cache, session index, and graph signals. No AIDE files are modified.' : '正在读取 catalog、使用缓存、会话索引和图谱信号。不会修改 AIDE 文件。',
    refreshingTitle: en ? 'Refreshing inventory' : '正在刷新清单',
    refreshingText: en ? 'Running the same read-only scan path as skm scan.' : '正在运行与 skm scan 相同的只读扫描路径。',
    localOnly: en ? 'local only · 127.0.0.1 · read-only phase' : '仅本机 · 127.0.0.1 · 第一阶段只读',
    navOverview: en ? 'Overview' : '总览',
    navDomains: en ? 'Governance Domains' : '治理分域',
    navSkills: en ? 'Skills' : 'Skill 清单',
    navGraph: en ? 'Knowledge Graph' : '知识图谱',
    navRecommend: en ? 'Recommendation' : '推荐',
    navCommands: en ? 'Command Center' : '命令中心',
    domainHint: en ? 'Each domain mirrors one CLI capability and gives the next command to run.' : '每个分域对应一类 CLI 能力，并给出下一步命令。',
    skillHint: en ? 'Filter installed skills by name, category, tool, or description.' : '按名称、分类、工具或描述筛选已安装 skill。',
    filterPlaceholder: en ? 'Filter skills...' : '筛选 skill...',
    graphHint: en ? 'A lightweight local preview. Export the full graph for dense exploration.' : '这里是轻量本地预览；复杂关系建议导出完整图谱。',
    recommendHint: en ? 'Describe a task and get local recommendations without calling an external model.' : '描述任务后，用本地规则推荐合适 skill，不调用外部模型。',
    recommendPlaceholder: en ? 'e.g. convert a web page to markdown' : '例如：把网页转成 markdown',
    recommendButton: en ? 'Recommend' : '推荐',
    commandHint: en ? 'Phase 1 copies commands only. Write actions are shown as dry-run commands.' : '第一阶段只复制命令；写操作只展示 dry-run 命令。',
    healthScore: en ? 'Health score' : '健康分',
    scoreNote: en ? 'Higher means safer and cleaner.' : '越高表示越健康、越可控。',
    skillMetric: en ? 'Merged unique skills.' : '合并去重后的 skill 数。',
    mcpMetric: en ? 'Unique MCP servers.' : '去重后的 MCP server 数。',
    neverUsed: en ? 'Never used' : '从未使用',
    neverUsedNote: en ? 'Based on observable logs.' : '基于可观测会话日志。',
    duplicates: en ? 'Duplicates' : '重复安装',
    duplicateNote: en ? 'Same-name real duplicate entities.' : '实体双份或重复治理线索。',
    sessionBytes: en ? 'Session logs' : '会话日志',
    sessionNote: en ? 'Total observed log size.' : '已观测日志总体积。',
    reclaimable: en ? 'Reclaimable' : '可释放',
    reclaimNote: en ? 'Dry-run cleanup estimate.' : 'dry-run 清理估算。',
    security: en ? 'Security H/M/L' : '安全 高/中/低',
    securityNote: en ? 'Static SKILL.md and MCP scan.' : '静态扫描 SKILL.md 与 MCP。',
    name: en ? 'Name' : '名称',
    category: en ? 'Category' : '分类',
    tools: en ? 'Tools' : '工具',
    usage: en ? 'Usage' : '使用',
    context: en ? 'Context' : '上下文',
    source: en ? 'Source' : '来源',
    hasSource: en ? 'tracked' : '已记录',
    noSource: en ? 'missing' : '缺失',
    risks: en ? 'Risks' : '风险',
    usage: en ? 'Usage' : '使用',
    state: en ? 'State' : '状态',
    versions: en ? 'Versions' : '版本',
    lifecycle: en ? 'Lifecycle' : '生命周期',
    sessions: en ? 'Sessions' : '会话',
    ready: en ? 'ready' : '正常',
    score: en ? 'Score' : '分数',
    reason: en ? 'Reason' : '理由',
    copied: en ? 'Command copied' : '命令已复制',
    needQuery: en ? 'Enter a task first' : '请先输入任务',
    noRecommendation: en ? 'No matching skill found.' : '没有找到匹配的 skill。',
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function zh(lang, zhText, enText) {
  return lang === 'en' ? enText : zhText;
}
