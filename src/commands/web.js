import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { mergeByDirName } from '../catalog.js';
import { buildOverview } from '../overview.js';
import { buildSessionIndex } from '../sessionsIndex.js';
import { buildUsageLookup, scanUsage } from '../usage.js';
import { paint } from '../utils.js';
import { runScan, ensureCatalog } from './scan.js';
import { buildKnowledgeGraph, edgeReason } from './graph.js';
import { buildReportData } from './report.js';
import { rankRecommendations } from './recommend.js';

const DEFAULT_PORT = 17361;
const HOST = '127.0.0.1';
const CLI_ENTRY = fileURLToPath(new URL('../../bin/skm.js', import.meta.url));
const WEB_CLIENT_URL = new URL('../web/client.js', import.meta.url);
const FAVICON_URL = new URL('../../docs/logo-mark.svg', import.meta.url);
let webClientCache = '';
let faviconCache = '';

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
      const requestLang = resolveWebLang(url.searchParams.get('lang'), lang);
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
      if (url.pathname.startsWith('/api/') && !isAllowedApiRequest(req, port)) return sendJson(res, 403, { error: 'forbidden_origin' });
      if (url.pathname === '/') return sendHtml(res, renderWebHtml(requestLang));
      if (url.pathname === '/app.js') return sendJavaScript(res, loadWebClient());
      if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') return sendFavicon(res);
      if (url.pathname === '/api/dashboard') return sendJson(res, 200, collectDashboard({ cwd, lang: requestLang, refresh: url.searchParams.get('refresh') === '1' }));
      if (url.pathname === '/api/recommend') return sendJson(res, 200, collectRecommendation({ cwd, lang: requestLang, query: url.searchParams.get('q') || '', top: url.searchParams.get('top') || '5' }));
      if (url.pathname === '/api/run') return runReadonlyCommand({ cwd, lang: requestLang, cmd: url.searchParams.get('cmd') || '', args: url.searchParams.get('args') || '' }, res);
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

function resolveWebLang(value, fallback = 'zh-CN') {
  return normalizeWebLang(value) || fallback;
}

function normalizeWebLang(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'en' || text.startsWith('en-')) return 'en';
  if (text === 'zh' || text === 'zh-cn' || text.startsWith('zh-')) return 'zh-CN';
  return null;
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
    labels: webLabels(lang),
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
        const sources = skillSourceUrls(skill);
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
          hasSource: sources.length > 0,
          sources,
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
    graph: {
      nodes: graph.nodes,
      edges: graph.edges.map((edge) => ({ ...edge, reason: edgeReason(edge, lang) })),
      stats: graph.stats,
      edgeTypes: graphEdgeMeta(lang),
    },
    commands: commandCatalog(lang),
  };
}

export function skillSourceUrls(skill) {
  const urls = [];
  for (const entry of skill.entries || [skill]) {
    const upstream = entry.upstream || {};
    urls.push(
      upstream.source,
      upstream.repository,
      upstream.homepage,
      upstream.git?.remote,
      ...(Array.isArray(upstream.urls) ? upstream.urls : []),
    );
  }
  return [...new Set(urls
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => redactSourceAddress(value.trim())))];
}

function redactSourceAddress(value) {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = 'REDACTED';
      url.password = '';
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|secret|password|signature|api[-_]?key|auth)/i.test(key)) url.searchParams.set(key, 'REDACTED');
    }
    return url.toString();
  } catch {
    return value;
  }
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

function graphEdgeMeta(lang) {
  const labels = lang === 'en' ? {
    same_family: 'suite membership', same_category: 'category membership', duplicate: 'duplicate',
    strong_alternative: 'strong alternative', weak_alternative: 'weak alternative', pipeline: 'workflow',
    upstream_downstream: 'upstream/downstream', reverse_transform: 'reverse conversion',
    shared_io_format: 'shared I/O format', same_platform_action: 'platform role overlap',
    shared_platform: 'platform membership', uses_mcp: 'uses MCP',
  } : {
    same_family: '套件归属', same_category: '分类归属', duplicate: '重复',
    strong_alternative: '强替代', weak_alternative: '弱替代', pipeline: '流程',
    upstream_downstream: '上下游', reverse_transform: '反向转换',
    shared_io_format: '共享格式', same_platform_action: '平台内分工',
    shared_platform: '平台归属', uses_mcp: '使用 MCP',
  };
  const colors = {
    same_family: '#8b5cf6', same_category: '#38bdf8', duplicate: '#ef4444',
    strong_alternative: '#f97316', weak_alternative: '#fbbf24', pipeline: '#22c55e',
    upstream_downstream: '#84cc16', reverse_transform: '#f97316',
    shared_io_format: '#06b6d4', same_platform_action: '#2dd4bf',
    shared_platform: '#14b8a6', uses_mcp: '#e879f9',
  };
  const descriptions = lang === 'en' ? {
    same_family: 'A skill belongs to a suite inferred from its directory-name prefix, such as baoyu-* or lark-*. This does not prove common authorship or repository origin.',
    same_category: 'A skill belongs to one classification category. This is a skill-to-category link, not a dependency or direct link between every skill in that category.',
    duplicate: 'Install records whose SKILL.md content hashes are identical. These are strong duplicate-cleanup candidates.',
    strong_alternative: 'Different skills with highly similar names or descriptions in the same category. They may cover nearly the same task.',
    weak_alternative: 'Skills with weaker similarity evidence. Use this for manual comparison, not automatic cleanup.',
    pipeline: 'One skill can consume another skill\'s output, forming a reusable workflow.',
    upstream_downstream: 'One skill can feed another, showing the likely order in a task chain.',
    reverse_transform: 'Two skills perform opposite conversions, such as Markdown to HTML and HTML to Markdown.',
    shared_io_format: 'Skills process the same input or output format, such as Markdown, HTML, PDF, or images.',
    same_platform_action: 'Skills appear to perform complementary roles inside the same platform. This is inferred from keywords and should be reviewed manually.',
    shared_platform: 'A skill name or description matches one specific platform node, such as GitHub, Lark, or Notion. Use the scope selector to inspect each platform separately.',
    uses_mcp: 'A skill description mentions both MCP and a specific MCP server. This is inferred and should be verified manually.',
  } : {
    same_family: '套件归属：根据目录名前缀推断 skill 属于某个套件，例如 baoyu-* 或 lark-*；它不等于已证明同一作者或同一仓库来源。',
    same_category: '分类归属：skill 连接到一个具体分类节点；这是 skill 到分类的归属关系，不代表同分类 skill 互相依赖。',
    duplicate: '重复：不同安装记录的 SKILL.md 内容哈希完全相同，是优先清理重复安装的强证据。',
    strong_alternative: '强替代：同分类下名称或描述高度相似，可能覆盖几乎相同的任务。',
    weak_alternative: '弱替代：存在较弱的相似性证据，适合人工比较，不建议据此自动清理。',
    pipeline: '流程：一个 skill 的输出可被另一个 skill 接收，从而组成可复用工作流。',
    upstream_downstream: '上下游：一个 skill 的产物可能流向另一个 skill，体现任务链路中的先后顺序。',
    reverse_transform: '反向转换：两个 skill 的转换方向相反，例如 Markdown 转 HTML 与 HTML 转 Markdown。',
    shared_io_format: '共享格式：两个 skill 处理相同输入或输出格式，例如 Markdown、HTML、PDF 或图片。',
    same_platform_action: '平台内分工：根据关键词推断同一平台内 skill 的互补动作；属于推断线索，需要人工确认。',
    shared_platform: '平台归属：名称或描述命中一个具体平台节点，例如 GitHub、飞书或 Notion；可用范围选择器分别查看每个平台。',
    uses_mcp: '使用 MCP：skill 描述同时提及 MCP 与具体 server。该关系属于推断，需要人工确认。',
  };
  const defaults = new Set(['same_family', 'duplicate', 'strong_alternative', 'pipeline', 'upstream_downstream', 'reverse_transform', 'shared_io_format', 'uses_mcp']);
  return Object.fromEntries(Object.keys(labels).map((type) => [type, {
    label: labels[type],
    description: descriptions[type],
    color: colors[type] || '#94a3b8',
    defaultVisible: defaults.has(type),
  }]));
}
function commandCatalog(lang) {
  const en = lang === "en";
  return [
    { id: "scan", command: "skm scan", description: en ? "Refresh inventory facts and show the governance overview" : "\u5237\u65b0\u4e8b\u5b9e\u6e05\u5355\u5e76\u5c55\u793a\u6cbb\u7406\u603b\u89c8", mode: "read", executable: true, params: "[--verbose]", examples: ["skm scan", "skm scan --verbose"], hint: en ? "Rebuilds the catalog from AIDE skill / MCP directories and refreshes the governance overview." : "\u4ece AIDE skill/MCP \u76ee\u5f55\u91cd\u5efa catalog\uff0c\u5e76\u5237\u65b0\u6cbb\u7406\u603b\u89c8\u3002" },
    { id: "status", command: "skm", description: en ? "Show the grouped governance overview" : "\u67e5\u770b\u603b\u5206\u7ed3\u6784\u6cbb\u7406\u603b\u89c8", mode: "read", executable: true, params: "", examples: ["skm"], hint: en ? "Reads the existing catalog, usage cache, and session index to show a domain-by-domain summary." : "\u8bfb\u53d6\u5df2\u6709 catalog\u3001\u4f7f\u7528\u7f13\u5b58\u548c\u4f1a\u8bdd\u7d22\u5f15\uff0c\u6309\u6cbb\u7406\u5206\u57df\u5c55\u793a\u6458\u8981\u3002" },
    { id: "list", command: "skm list", description: en ? "List all skills by category" : "\u6309\u5206\u7c7b\u67e5\u770b\u6240\u6709 skill", mode: "read", executable: true, params: "[--tool claude|codex|cursor|gemini] [--category keyword] [--mcp] [--raw]", examples: ["skm list", "skm list --tool claude", "skm list --mcp"], hint: en ? "Supports filtering by tool, category, and scope. Use --mcp to list MCP servers instead." : "\u652f\u6301\u6309\u5de5\u5177\u3001\u5206\u7c7b\u3001\u8303\u56f4\u8fc7\u6ee4\uff1b--mcp \u5217\u51fa MCP server\u3002" },
    { id: "search", command: "skm search <keyword>", description: en ? "Search skills by name, category, and description" : "\u6309\u540d\u79f0\u3001\u5206\u7c7b\u548c\u63cf\u8ff0\u641c\u7d22 skill", mode: "read", executable: true, params: "<keyword> [more keywords]", examples: ["skm search markdown"], hint: en ? "Fuzzy matches against skill name, category, and description; results are sorted by relevance." : "\u5728\u540d\u79f0\u3001\u5206\u7c7b\u3001\u63cf\u8ff0\u4e2d\u6a21\u7cca\u5339\u914d\uff0c\u6309\u76f8\u5173\u5ea6\u6392\u5e8f\u3002" },
    { id: "risks", command: "skm risks", description: en ? "Inspect duplicate, idle, context, and log risks" : "\u67e5\u770b\u91cd\u590d\u3001\u95f2\u7f6e\u3001\u4e0a\u4e0b\u6587\u548c\u65e5\u5fd7\u98ce\u9669", mode: "read", executable: true, params: "[--json]", examples: ["skm risks"], hint: en ? "Read-only risk report: duplicates, idle skills, context cost, MCP schema estimate, and session log size." : "\u53ea\u8bfb\u98ce\u9669\u62a5\u544a\uff1a\u91cd\u590d\u3001\u95f2\u7f6e skill\u3001\u4e0a\u4e0b\u6587\u5f00\u9500\u3001MCP schema \u4f30\u7b97\u3001\u4f1a\u8bdd\u65e5\u5fd7\u4f53\u79ef\u3002" },
    { id: "audit", command: "skm audit", description: en ? "Audit usage frequency and static safety findings" : "\u5ba1\u8ba1\u771f\u5b9e\u4f7f\u7528\u9891\u7387\u548c\u9759\u6001\u5b89\u5168\u53d1\u73b0", mode: "read", executable: true, params: "[--json] [--history]", examples: ["skm audit", "skm audit --json"], hint: en ? "Usage frequency, zombie skills, MCP usage, context cost, and static security audit." : "\u4f7f\u7528\u9891\u7387\u3001\u50f5\u5c38 skill\u3001MCP \u4f7f\u7528\u3001\u4e0a\u4e0b\u6587\u5f00\u9500\u3001\u9759\u6001\u5b89\u5168\u5ba1\u8ba1\uff1b\u5feb\u7167\u81ea\u52a8\u5f52\u6863\u3002" },
    { id: "sessions", command: "skm sessions", description: en ? "Show session log distribution" : "\u67e5\u770b\u4f1a\u8bdd\u65e5\u5fd7\u5206\u5e03", mode: "read", executable: true, params: "[--clean --days N --keep N --dry-run]", examples: ["skm sessions", "skm sessions --clean --days 30 --keep 3 --dry-run"], hint: en ? "Read-only by default. Cleanup parameters are accepted in the Web console only when --dry-run is present." : "\u9ed8\u8ba4\u53ea\u8bfb\uff1bWeb \u5de5\u4f5c\u53f0\u53ea\u5141\u8bb8\u5e26 --dry-run \u7684\u6e05\u7406\u53c2\u6570\uff0c\u4ec5\u751f\u6210\u9884\u89c8\u8ba1\u5212\u3002" },
    { id: "doctor", command: "skm doctor", description: en ? "Diagnose environment and local prerequisites" : "\u8bca\u65ad\u73af\u5883\u548c\u672c\u673a\u4f9d\u8d56\u72b6\u6001", mode: "read", executable: true, params: "[--json]", examples: ["skm doctor"], hint: en ? "Checks Node version, zero-dependency integrity, data directories, and optional advisor CLI availability." : "\u68c0\u67e5 Node \u7248\u672c\u3001\u96f6\u4f9d\u8d56\u5b8c\u6574\u6027\u3001\u6570\u636e\u76ee\u5f55\u3001\u53ef\u9009 advisor CLI \u53ef\u7528\u6027\u3002" },
    { id: "recommend", command: "skm ask \"task\"", description: en ? "Recommend skills for a natural-language task" : "\u6309\u81ea\u7136\u8bed\u8a00\u4efb\u52a1\u63a8\u8350 skill", mode: "read", executable: false, params: "<task description>", examples: ["skm ask \"convert web page to markdown\""], hint: en ? "Use the Recommendation section above for interactive recommendations." : "\u63a8\u8350\u529f\u80fd\u5728\u9875\u9762\u4e0a\u65b9\u7684\u63a8\u8350\u533a\u76f4\u63a5\u4ea4\u4e92\u5373\u53ef\u3002" },
    { id: "outdated", command: "skm outdated --online", description: en ? "Check upstream freshness online" : "\u8054\u7f51\u68c0\u67e5\u4e0a\u6e38\u7248\u672c\u7ebf\u7d22", mode: "read", executable: false, params: "[--online] [--refresh]", examples: ["skm outdated", "skm outdated --online"], hint: en ? "Read-only; never auto-updates skills." : "\u53ea\u8bfb\uff0c\u4e0d\u4f1a\u81ea\u52a8\u66f4\u65b0\uff1b\u79bb\u7ebf\u6a21\u5f0f\u53ea\u770b\u672c\u5730 metadata\u3002" },
    { id: "sources", command: "skm sources missing", description: en ? "List skills missing upstream sources" : "\u5217\u51fa\u7f3a\u5c11\u4e0a\u6e38\u6765\u6e90\u7684 skill", mode: "read", executable: false, params: "list | missing | add | remove | check | wizard", examples: ["skm sources missing"], hint: en ? "Skills without source cannot be checked for freshness." : "\u7f3a\u5c11 source \u7684 skill \u65e0\u6cd5\u5224\u65ad\u7248\u672c\u3002" },
    { id: "state", command: "skm state plan", description: en ? "Generate a read-only state governance plan" : "\u751f\u6210\u53ea\u8bfb\u964d\u8f7d\u6cbb\u7406\u8ba1\u5212", mode: "read", executable: false, params: "plan | list | set", examples: ["skm state plan"], hint: en ? "Plan is always read-only. state set requires confirmation and supports --dry-run on CLI." : "plan \u6c38\u8fdc\u53ea\u8bfb\uff1bset \u64cd\u4f5c\u9700\u8981\u786e\u8ba4\uff0c\u547d\u4ee4\u884c\u652f\u6301 --dry-run\u3002" },
    { id: "lock", command: "skm lock diff / verify", description: en ? "Compare or verify lifecycle baselines" : "\u5bf9\u6bd4\u6216\u6821\u9a8c\u751f\u547d\u5468\u671f\u57fa\u7ebf", mode: "read", executable: false, params: "[--json] | diff [file] | verify [file]", examples: ["skm lock diff", "skm lock verify"], hint: en ? "Use skm lock to write a baseline, then diff / verify to detect drift." : "\u5148\u5728\u547d\u4ee4\u884c\u7528 skm lock \u5efa\u57fa\u7ebf\uff0c\u518d diff/verify \u770b\u6f02\u79fb\u3002" },
    { id: "policy", command: "skm policy check", description: en ? "Check lifecycle governance policy" : "\u68c0\u67e5\u751f\u547d\u5468\u671f\u6cbb\u7406\u7b56\u7565", mode: "read", executable: false, params: "init | check [--json]", examples: ["skm policy check"], hint: en ? "Run policy init once to create thresholds, then policy check." : "\u5148 policy init \u5efa\u9ed8\u8ba4\u9608\u503c\uff0c\u518d policy check \u68c0\u67e5\u3002" },
    { id: "eval", command: "skm eval --all", description: en ? "Evaluate skill quality and cleanup priority" : "\u8bc4\u6d4b skill \u8d28\u91cf\u548c\u6574\u7406\u4f18\u5148\u7ea7", mode: "read", executable: false, params: "[skill] [--all] [--json]", examples: ["skm eval --all"], hint: en ? "Quality scoring: description completeness, freshness, usage, security findings." : "\u4ece\u63cf\u8ff0\u5b8c\u6574\u5ea6\u3001\u7248\u672c\u7ebf\u7d22\u3001\u4f7f\u7528\u9891\u7387\u3001\u5b89\u5168\u53d1\u73b0\u7b49\u7ef4\u5ea6\u6253\u5206\u3002" },
    { id: "graph", command: "skm graph --format html", description: en ? "Export the full knowledge graph" : "\u5bfc\u51fa\u5b8c\u6574\u77e5\u8bc6\u56fe\u8c31", mode: "read", executable: false, params: "--format html --output <file>", examples: ["skm graph --format html --output skill-graph.html"], hint: en ? "The graph section above already supports filtering, search, and drag." : "\u9875\u9762\u4e0a\u65b9\u77e5\u8bc6\u56fe\u8c31\u5df2\u652f\u6301\u8fc7\u6ee4\u3001\u641c\u7d22\u3001\u62d6\u52a8\uff1b\u5b8c\u6574 HTML \u7528\u547d\u4ee4\u884c\u5bfc\u51fa\u3002" },
    { id: "report", command: "skm report --format html", description: en ? "Export a one-page HTML report" : "\u5bfc\u51fa\u4e00\u9875\u5f0f HTML \u62a5\u544a", mode: "read", executable: false, params: "--format html|json|summary [--output <file>] [--anonymize]", examples: ["skm report --format html --output skm-report.html"], hint: en ? "Exports health, risks, usage, sessions, and graph summary to a single HTML page." : "\u628a\u5065\u5eb7\u5206\u3001\u98ce\u9669\u3001\u4f7f\u7528\u3001\u4f1a\u8bdd\u3001\u56fe\u8c31\u6c47\u603b\u5bfc\u51fa\u5230\u5355\u9875 HTML\u3002" },
    { id: "install", command: "skm install <source> --dry-run", description: en ? "Preview a skill install plan" : "\u9884\u89c8 skill \u5b89\u88c5\u8ba1\u5212", mode: "dry-run", executable: false, params: "<source> --tool <tool> [--dry-run] [--yes]", examples: ["skm install ./my-skill --tool claude --dry-run"], hint: en ? "Write action. Always run with --dry-run first." : "\u5199\u64cd\u4f5c\u3002\u5148\u52a0 --dry-run \u770b\u8ba1\u5212\uff0c\u786e\u8ba4\u65e0\u8bef\u540e\u53bb\u6389\u518d\u6267\u884c\u3002" },
    { id: "update", command: "skm update <skill> --dry-run", description: en ? "Preview a skill update plan" : "\u9884\u89c8 skill \u66f4\u65b0\u8ba1\u5212", mode: "dry-run", executable: false, params: "<skill> [--tool <tool>] [--dry-run] [--yes]", examples: ["skm update baoyu-image-gen --dry-run"], hint: en ? "Write action. Backs up old directory; --dry-run recommended first." : "\u5199\u64cd\u4f5c\u3002\u66f4\u65b0\u524d\u5907\u4efd\u65e7\u76ee\u5f55\uff1b\u5efa\u8bae\u5148 --dry-run\u3002" },
    { id: "rollback", command: "skm rollback <skill> --dry-run", description: en ? "Preview a skill rollback plan" : "\u9884\u89c8 skill \u56de\u6eda\u8ba1\u5212", mode: "dry-run", executable: false, params: "<skill> [--tool <tool>] [--dry-run] [--yes]", examples: ["skm rollback baoyu-image-gen --dry-run"], hint: en ? "Write action. Restores from backup; backs up current state before rollback." : "\u5199\u64cd\u4f5c\u3002\u4ece skm \u5907\u4efd\u6062\u590d\uff1b\u56de\u6eda\u524d\u518d\u5907\u4efd\u5f53\u524d\u72b6\u6001\uff1b\u5148 --dry-run\u3002" },
    { id: "disable", command: "skm disable <skill> --dry-run", description: en ? "Preview a soft-disable action" : "\u9884\u89c8\u8f6f\u7981\u7528\u64cd\u4f5c", mode: "dry-run", executable: false, params: "<skill> [--mcp <name>] [--dry-run]", examples: ["skm disable gsap-plugins --dry-run", "skm disable --mcp drawio --dry-run"], hint: en ? "Write action. Renames directories or edits MCP config. --dry-run shows plan only." : "\u5199\u64cd\u4f5c\u3002\u91cd\u547d\u540d\u76ee\u5f55\u6216\u4fee\u6539 MCP \u914d\u7f6e\uff1b--dry-run \u53ea\u770b\u8ba1\u5212\uff0c\u4e0d\u6539\u52a8\u3002" },
    { id: "enable", command: "skm enable", description: en ? "List restorable disabled items" : "\u67e5\u770b\u53ef\u6062\u590d\u7684\u7981\u7528\u9879", mode: "read", executable: false, params: "[skill...] [--mcp <name>] [--dry-run]", examples: ["skm enable", "skm enable gsap-plugins --dry-run"], hint: en ? "Without arguments, lists disabled items. Named restore supports --dry-run on CLI." : "\u4e0d\u5e26\u53c2\u6570\u5217\u51fa\u5df2\u7981\u7528\u9879\uff1b\u5e26\u540d\u79f0\u6062\u590d\u65f6\uff0c\u547d\u4ee4\u884c\u652f\u6301 --dry-run\u3002" },
  ];
}

const READONLY_COMMANDS = new Set(['scan', 'status', 'list', 'search', 'risks', 'audit', 'sessions', 'doctor']);

function runReadonlyCommand({ cwd, lang, cmd, args }, res) {
  if (!READONLY_COMMANDS.has(cmd)) return sendJson(res, 400, { error: 'command_not_allowed' });
  let safeArgs;
  try {
    safeArgs = parseWebArgs(args, lang);
  } catch (error) {
    return sendJson(res, 400, { error: 'invalid_args', message: error.message });
  }
  const badFlags = ['--yes', '-y', '--output', '--export'];
  for (const a of safeArgs) {
    if (badFlags.includes(a)) return sendJson(res, 400, { error: 'flag_not_allowed', flag: a });
    if (hasShellMeta(a)) return sendJson(res, 400, { error: 'invalid_arg', arg: a });
  }
  if (cmd === 'status' && safeArgs.length) {
    return sendJson(res, 400, { error: 'invalid_args', message: zh(lang, '裸命令不接受额外参数', 'The bare command does not accept extra arguments') });
  }
  if (safeArgs.includes('--clean') && (cmd !== 'sessions' || !safeArgs.includes('--dry-run'))) {
    return sendJson(res, 400, { error: 'flag_not_allowed', flag: '--clean' });
  }
  const argv = cmd === 'status' ? [] : [cmd, ...safeArgs];
  const proc = spawnSync(process.execPath, [CLI_ENTRY, ...argv], {
    cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, SKM_LANG: lang },
  });
  let data = null;
  let isJson = false;
  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';
  try {
    if (stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
      data = JSON.parse(stdout);
      isJson = true;
    }
  } catch (_) { /* ignore */ }
  sendJson(res, 200, {
    command: argv.length ? `skm ${argv.join(' ')}` : 'skm',
    exitCode: proc.status,
    isJson, data,
    stdout: isJson ? '' : stdout,
    stderr,
  });
}

function loadWebClient() {
  if (!webClientCache) webClientCache = readFileSync(WEB_CLIENT_URL, 'utf8');
  return webClientCache;
}

export function parseWebArgs(value, lang = 'zh-CN') {
  const source = String(value || '').trim();
  if (!source) return [];
  if (source.length > 2000) throw new Error(zh(lang, '参数过长', 'Arguments are too long'));
  const args = [];
  let current = '';
  let quote = '';
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      const next = source[index + 1];
      if (next && (/\s/.test(next) || ['\\', '"', "'"].includes(next))) escaped = true;
      else current += char;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) args.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (quote) throw new Error(zh(lang, '参数中的引号未闭合', 'An argument quote is not closed'));
  if (current) args.push(current);
  if (args.length > 80) throw new Error(zh(lang, '参数数量过多', 'Too many arguments'));
  return args;
}

function sendJavaScript(res, source) {
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(source);
}

function sendFavicon(res) {
  if (!faviconCache) faviconCache = readFileSync(FAVICON_URL, 'utf8');
  res.writeHead(200, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': 'public, max-age=86400',
    'x-content-type-options': 'nosniff',
  });
  res.end(faviconCache);
}

function sendEmpty(res) {
  res.writeHead(204, { 'cache-control': 'public, max-age=86400' });
  res.end();
}

function hasShellMeta(s) {
  const bad = [';', '&', '|', '$', '`', '<', '>'];
  for (const ch of bad) { if (s.includes(ch)) return true; }
  return false;
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
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
html { scroll-behavior:smooth; scroll-padding-top:92px; }
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
.lang-btn, .theme-btn, .action-btn { height:34px; border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:0 11px; box-shadow:0 10px 26px rgba(0,0,0,.1); }
.lang-btn.active, .theme-btn.active { background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 34%, transparent), color-mix(in srgb, var(--accent-2) 24%, transparent)); border-color:var(--accent); }
.action-btn.primary { color:#06111f; background:linear-gradient(135deg, var(--accent), var(--accent-3)); font-weight:760; }
.hero { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr); gap:18px; padding:28px clamp(16px,3vw,34px) 16px; }
.hero-main { position:relative; min-height:330px; border:1px solid var(--line); border-radius:18px; background:var(--hero); box-shadow:var(--shadow); overflow:hidden; padding:30px; }
.hero-main::after { content:""; position:absolute; inset:0; background:linear-gradient(115deg, transparent 0 38%, color-mix(in srgb, var(--accent) 18%, transparent) 48%, transparent 58%); animation:sweep 6s linear infinite; }
.hero-copy { position:relative; z-index:1; max-width:780px; }
.eyebrow { color:var(--accent-3); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; }
.hero h2 { margin:12px 0 12px; font-size:52px; line-height:1.02; letter-spacing:0; max-width:980px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
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
.content > section { scroll-margin-top:92px; }
.grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.card { border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:16px; box-shadow:0 14px 42px rgba(0,0,0,.12); min-width:0; }
.card h3 { margin:0 0 12px; font-size:16px; }
.metric b { display:block; font-size:30px; line-height:1; }
.metric span { color:var(--muted); font-size:12px; }
.metric { text-align:center; display:grid; align-content:center; justify-items:center; }
.metric p { color:var(--muted); font-size:12px; line-height:1.5; margin:8px 0 0; }
.muted { color:var(--muted); }
.wide { grid-column:span 2; } .full { grid-column:1 / -1; }
.section-head { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:12px; }
.section-head p { margin:4px 0 0; color:var(--muted); font-size:13px; }
.table-wrap { overflow:auto; border:1px solid var(--line); border-radius:10px; }
table { width:100%; border-collapse:collapse; min-width:720px; }
th, td { text-align:left; padding:10px 11px; border-bottom:1px solid var(--line); vertical-align:top; font-size:13px; }
th { color:var(--muted); font-weight:760; background:color-mix(in srgb, var(--panel-strong) 86%, transparent); }
tr:last-child td { border-bottom:0; }
.skill-table { min-width:1040px; table-layout:fixed; }
.skill-table th:not(:first-child), .skill-table td:not(:first-child) { text-align:center; vertical-align:middle; }
.skill-table th:nth-child(1) { width:36%; }
.skill-table th:nth-child(2) { width:14%; }
.skill-table th:nth-child(3) { width:13%; }
.skill-table th:nth-child(4) { width:13%; }
.skill-table th:nth-child(5) { width:12%; }
.skill-table th:nth-child(6) { width:12%; }
.sort-button { display:inline-flex; align-items:center; justify-content:center; gap:5px; width:100%; padding:0; background:transparent; color:inherit; font-weight:inherit; }
.sort-button:hover, .sort-button.active { color:var(--text); }
.sort-indicator { width:14px; color:var(--accent); font-size:12px; }
.source-status { display:inline-flex; align-items:center; justify-content:center; min-width:62px; min-height:28px; padding:4px 9px; border:1px solid color-mix(in srgb, var(--accent) 34%, transparent); border-radius:6px; background:color-mix(in srgb, var(--accent) 12%, transparent); color:var(--text); font-size:12px; white-space:nowrap; cursor:help; }
.source-status.missing { border-color:color-mix(in srgb, var(--warn) 34%, transparent); background:color-mix(in srgb, var(--warn) 12%, transparent); color:var(--warn); }
.source-tooltip { position:fixed; z-index:30; width:min(420px,calc(100vw - 24px)); padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--panel-strong); box-shadow:var(--shadow); color:var(--text); }
.source-tooltip strong { display:block; margin-bottom:7px; font-size:12px; }
.source-tooltip p { margin:0; color:var(--muted); font-size:12px; line-height:1.55; overflow-wrap:anywhere; }
.source-tooltip a, .source-tooltip code { display:block; color:var(--accent); font:11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap:anywhere; text-decoration:none; }
.source-tooltip a + a, .source-tooltip code + code, .source-tooltip a + code, .source-tooltip code + a { margin-top:6px; padding-top:6px; border-top:1px solid var(--line); }
.pagination { display:flex; align-items:center; justify-content:flex-end; gap:10px; min-height:42px; padding:8px 2px 0; color:var(--muted); font-size:12px; }
.pagination.top { padding:0 2px 8px; }
.page-button { width:34px; height:32px; border:1px solid var(--line); border-radius:7px; background:var(--panel-strong); color:var(--text); font-size:20px; line-height:1; }
.page-button:disabled { cursor:not-allowed; opacity:.35; }
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
.searchbar select { min-width:150px; height:38px; padding:0 10px; border-radius:9px; border:1px solid var(--line); background:var(--panel-strong); color:var(--text); outline:none; }
.skill-name { appearance:none; border:0; background:none; padding:0; color:var(--text); font:inherit; line-height:1.4; text-align:left; cursor:help; }
.skill-name:hover, .skill-name:focus { color:var(--accent); outline:none; }
.graph-layout { display:grid; grid-template-columns:220px minmax(0,1fr) 240px; gap:12px; min-height:500px; }
.graph-insights { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin-bottom:12px; }
.graph-insight { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:5px 10px; align-items:center; padding:11px 12px; border:1px solid var(--line); border-radius:8px; background:color-mix(in srgb, var(--panel-strong) 64%, transparent); text-align:left; }
.graph-insight:hover { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, var(--panel-strong)); }
.graph-insight strong { font-size:13px; }
.graph-insight b { grid-row:1 / span 2; grid-column:2; font-size:24px; color:var(--accent-3); }
.graph-insight small { color:var(--muted); line-height:1.35; }
.graph-filters, .graph-detail { border:1px solid var(--line); border-radius:10px; background:color-mix(in srgb, var(--panel-strong) 72%, transparent); padding:12px; min-width:0; }
.graph-filters { display:flex; flex-direction:column; gap:8px; align-self:stretch; }
.graph-scope-label, .relation-group > b { color:var(--text); font-size:12px; }
.graph-scope-select { width:100%; min-height:36px; padding:0 8px; border:1px solid var(--line); border-radius:7px; background:var(--panel-strong); color:var(--text); }
.graph-scope-hint { margin:-2px 0 5px; color:var(--muted); font-size:10px; line-height:1.45; }
.relation-group { display:grid; gap:4px; padding-top:7px; border-top:1px solid var(--line); }
.relation-group > b { margin-bottom:2px; color:var(--muted); }
.relation-option { display:flex; align-items:center; gap:8px; min-height:28px; color:var(--muted); font-size:12px; cursor:pointer; }
.relation-option input { accent-color:var(--accent); }
.relation-swatch { width:10px; height:10px; border-radius:50%; flex:0 0 auto; box-shadow:0 0 8px currentColor; }
.relation-help { position:relative; min-width:0; }
.relation-help small { color:var(--muted); }
.relation-help:hover::after, .relation-help:focus::after { content:attr(data-help); position:absolute; left:0; bottom:calc(100% + 8px); width:250px; padding:9px 10px; border:1px solid var(--line); border-radius:7px; background:var(--panel-strong); color:var(--text); box-shadow:var(--shadow); line-height:1.5; z-index:9; pointer-events:none; }
.graph-main { min-width:0; display:flex; flex-direction:column; gap:8px; }
.graph-toolbar { display:flex; align-items:center; gap:10px; min-height:38px; }
.graph-search { min-width:0; flex:1; height:36px; padding:0 11px; border:1px solid var(--line); border-radius:8px; background:var(--panel-strong); color:var(--text); }
.graph-stats { color:var(--muted); font-size:12px; white-space:nowrap; }
.graph-reset { height:34px; padding:0 10px; border:1px solid var(--line); border-radius:7px; background:var(--panel-strong); color:var(--text); white-space:nowrap; }
.graph-box { position:relative; width:100%; min-height:454px; flex:1; border:1px solid var(--line); border-radius:10px; background:radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 54%), linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, transparent), rgba(0,0,0,.18) 58%, rgba(0,0,0,.42)); overflow:hidden; perspective:900px; }
.graph-box::before { content:""; position:absolute; inset:-6% -10% -8%; background:repeating-linear-gradient(90deg, transparent 0 54px, color-mix(in srgb, var(--accent) 8%, transparent) 54px 55px), repeating-linear-gradient(0deg, transparent 0 54px, color-mix(in srgb, var(--accent-2) 7%, transparent) 54px 55px); opacity:.22; transform-origin:50% 86%; transform:perspective(900px) rotateX(72deg) translateY(14%); pointer-events:none; }
.graph-box::after { content:""; position:absolute; left:10%; right:10%; bottom:5%; height:24%; border-radius:50%; background:color-mix(in srgb, var(--accent) 10%, transparent); filter:blur(22px); transform:rotateX(70deg); pointer-events:none; }
.graph-box canvas { position:relative; z-index:1; width:100%; height:100%; display:block; cursor:grab; touch-action:none; }
.graph-box canvas:active { cursor:grabbing; }
.graph-empty { position:absolute; inset:0; z-index:2; display:grid; place-items:center; color:var(--muted); pointer-events:none; }
.graph-detail h4 { margin:12px 0 8px; font-size:17px; overflow-wrap:anywhere; }
.graph-detail p, .detail-empty { color:var(--muted); font-size:12px; line-height:1.55; overflow-wrap:anywhere; }
.graph-detail dl { display:grid; grid-template-columns:1fr auto; gap:7px; font-size:12px; margin:16px 0; }
.graph-detail dt { color:var(--muted); } .graph-detail dd { margin:0; }
.detail-relations { display:grid; gap:6px; }
.detail-relations button { display:grid; grid-template-columns:7px minmax(0,1fr) auto; align-items:start; gap:7px; text-align:left; padding:7px; border:1px solid var(--line); border-radius:7px; background:transparent; color:var(--muted); font-size:11px; line-height:1.4; }
.detail-relations button span { width:7px; height:7px; border-radius:50%; margin-top:4px; flex:0 0 auto; }
.detail-relations button em { padding:1px 4px; border:1px solid var(--line); border-radius:4px; color:var(--accent-3); font-size:9px; font-style:normal; white-space:nowrap; }
.detail-relations button small { grid-column:2 / 4; color:color-mix(in srgb, var(--muted) 82%, transparent); }
.graph-actions { display:grid; gap:6px; margin:12px 0; }
.graph-actions button { min-height:32px; padding:6px 8px; border:1px solid var(--line); border-radius:7px; background:color-mix(in srgb, var(--accent) 8%, transparent); color:var(--text); text-align:left; font-size:11px; overflow-wrap:anywhere; }
.graph-actions button.primary { border-color:var(--accent); color:var(--accent); }
.command-card { min-height:0; gap:9px; }
.command-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.icon-button { width:32px; height:32px; border:1px solid var(--line); border-radius:7px; background:transparent; }
.command-line { width:100%; min-height:38px; padding:8px 10px; border:1px solid var(--line); border-radius:7px; background:rgba(0,0,0,.28); color:var(--accent-3); text-align:left; font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap:anywhere; }
.parameter-label { display:grid; gap:5px; color:var(--muted); font-size:11px; }
.parameter-label input { width:100%; height:34px; border:1px solid var(--line); border-radius:7px; background:var(--panel-strong); color:var(--text); padding:0 9px; }
.parameter-label input:disabled { opacity:.45; }
.command-card details { color:var(--muted); font-size:12px; }
.command-card summary { cursor:pointer; }
.command-examples { display:grid; gap:5px; }
.command-examples code { overflow-wrap:anywhere; color:var(--accent-3); }
.command-actions { display:flex; gap:8px; margin-top:auto; }
.cmd-terminal { border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#030712; color:#d1fae5; }
.cmd-terminal pre { min-height:100px; max-height:340px; overflow:auto; margin:0; padding:10px; white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.toast { position:fixed; right:18px; bottom:18px; z-index:20; border:1px solid var(--line); background:var(--panel-strong); color:var(--text); padding:10px 12px; border-radius:10px; box-shadow:var(--shadow); opacity:0; transform:translateY(10px); transition:.22s ease; }
.toast.show { opacity:1; transform:translateY(0); }
.hidden { display:none !important; }
@keyframes cubeSpin { from { transform:rotateX(-22deg) rotateY(0deg) rotateZ(0deg); } to { transform:rotateX(338deg) rotateY(360deg) rotateZ(360deg); } }
@keyframes orbit { from { transform:rotateX(64deg) rotateZ(0deg); } to { transform:rotateX(64deg) rotateZ(360deg); } }
@keyframes sweep { from { transform:translateX(-90%); } to { transform:translateX(90%); } }
@media (max-width:1180px) { .graph-layout { grid-template-columns:190px minmax(0,1fr); } .graph-detail { grid-column:1 / -1; } .graph-insights { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:1040px) { .hero { grid-template-columns:1fr; } .layout { grid-template-columns:1fr; } .rail { position:relative; top:auto; display:flex; overflow:auto; } .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:680px) { html { scroll-padding-top:12px; } .shell, .topbar, .hero, .layout, .content, .card { max-width:100vw; min-width:0; } .topbar { position:relative; top:auto; align-items:flex-start; flex-direction:column; overflow:hidden; } .controls { width:100%; min-width:0; display:grid; grid-template-columns:1fr; gap:8px; } .lang-btn, .theme-btn, .action-btn { width:100%; min-width:0; padding:0 6px; font-size:14px; } .hero { grid-template-columns:minmax(0,1fr); overflow:hidden; } .hero-main { padding:22px; min-width:0; } .grid, .domains, .graph-layout, .graph-insights { grid-template-columns:1fr; } .wide { grid-column:1 / -1; } .hero h2 { font-size:28px; line-height:1.04; white-space:normal; } .graph-filters { max-height:250px; overflow:auto; } .graph-detail { grid-column:auto; } .graph-toolbar { align-items:stretch; flex-direction:column; } .graph-stats { white-space:normal; } .pagination { justify-content:space-between; } }
</style>
</head>
<body data-theme="cyberpunk">
<div class="shell">
  <header class="topbar">
    <div class="brand"><div class="mark">SKM</div><div><h1>${escapeHtml(labels.title)}</h1><p>${escapeHtml(labels.subtitle)}</p></div></div>
    <div class="controls">
      <button class="lang-btn${lang === 'zh-CN' ? ' active' : ''}" data-lang-target="zh-CN" aria-pressed="${lang === 'zh-CN'}">${escapeHtml(labels.langZh)}</button>
      <button class="lang-btn${lang === 'en' ? ' active' : ''}" data-lang-target="en" aria-pressed="${lang === 'en'}">${escapeHtml(labels.langEn)}</button>
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
          <div class="face f1">${escapeHtml(labels.cubeScan)}</div><div class="face f2">${escapeHtml(labels.cubeRisk)}</div><div class="face f3">${escapeHtml(labels.cubeLock)}</div>
          <div class="face f4">${escapeHtml(labels.cubeMcp)}</div><div class="face f5">${escapeHtml(labels.cubeSkill)}</div><div class="face f6">${escapeHtml(labels.cubeGraph)}</div>
        </div>
      </div>
      <h3 id="loader-title">${escapeHtml(labels.loadingTitle)}</h3>
      <p id="loader-text">${escapeHtml(labels.loadingText)}</p>
    </aside>
  </section>
  <div class="layout">
    <nav class="rail">
      <a href="#overview">${escapeHtml(labels.navOverview)}</a>
      <a href="#skills">${escapeHtml(labels.navSkills)}</a>
      <a href="#graph">${escapeHtml(labels.navGraph)}</a>
      <a href="#recommend">${escapeHtml(labels.navRecommend)}</a>
      <a href="#commands">${escapeHtml(labels.navCommands)}</a>
    </nav>
    <main class="content">
      <section id="overview" class="grid"></section>
      <section id="skills" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navSkills)}</h3><p>${escapeHtml(labels.skillHint)}</p></div><div class="searchbar"><input id="skill-filter" placeholder="${escapeHtml(labels.filterPlaceholder)}"><select id="skill-usage-filter" aria-label="${escapeHtml(labels.usageFilter)}"><option value="all">${escapeHtml(labels.usageAll)}</option><option value="used">${escapeHtml(labels.usageInUse)}</option><option value="unused">${escapeHtml(labels.usageUnused)}</option></select></div></div>${skillPagination(labels, 'top')}<div class="table-wrap"><table class="skill-table"><thead><tr><th>${escapeHtml(labels.name)}</th><th>${escapeHtml(labels.category)}</th><th>${escapeHtml(labels.tools)}</th><th aria-sort="descending"><button class="sort-button active" data-skill-sort="usage">${escapeHtml(labels.usage)}<span class="sort-indicator">↓</span></button></th><th aria-sort="none"><button class="sort-button" data-skill-sort="context">${escapeHtml(labels.context)}<span class="sort-indicator">↕</span></button></th><th>${escapeHtml(labels.source)}</th></tr></thead><tbody id="skill-rows"></tbody></table></div>${skillPagination(labels, 'bottom')}</section>
      <section id="graph" class="card full">
        <div class="section-head"><div><h3>${escapeHtml(labels.navGraph)}</h3><p>${escapeHtml(labels.graphHint)}</p></div></div>
        <div class="graph-insights" id="graph-insights"></div>
        <div class="graph-layout">
          <aside class="graph-filters" id="graph-filters"></aside>
          <div class="graph-main">
            <div class="graph-toolbar"><input class="graph-search" id="graph-search" placeholder="${escapeHtml(labels.graphSearch)}"><div class="graph-stats" id="graph-stats"></div><button class="graph-reset" id="graph-reset">${escapeHtml(labels.graphReset)}</button></div>
            <div class="graph-box" id="graph-box"><canvas id="graph-canvas"></canvas><div class="graph-empty hidden" id="graph-empty">${escapeHtml(labels.graphEmpty)}</div></div>
          </div>
          <aside class="graph-detail" id="graph-detail"><div class="detail-empty">${escapeHtml(labels.graphDetailEmpty)}</div></aside>
        </div>
      </section>
      <section id="recommend" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navRecommend)}</h3><p>${escapeHtml(labels.recommendHint)}</p></div></div><div class="searchbar"><input id="recommend-input" placeholder="${escapeHtml(labels.recommendPlaceholder)}"><button class="action-btn primary" id="recommend-btn">${escapeHtml(labels.recommendButton)}</button></div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>${escapeHtml(labels.name)}</th><th>${escapeHtml(labels.category)}</th><th>${escapeHtml(labels.score)}</th><th>${escapeHtml(labels.reason)}</th></tr></thead><tbody id="recommend-rows"></tbody></table></div></section>
      <section id="commands" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navCommands)}</h3><p>${escapeHtml(labels.commandHint)}</p></div></div><div class="domains" id="command-list"></div></section>
    </main>
  </div>
</div>
<div class="toast" id="toast"></div>
<div class="source-tooltip hidden" id="source-tooltip" role="tooltip"></div>
<script src="/app.js"></script>
</body>
</html>`;
}

function skillPagination(labels, position) {
  return `<div class="pagination skill-pagination ${position}"><span class="skill-page-summary"></span><button class="page-button" data-skill-page="prev" title="${escapeHtml(labels.previousPage)}" aria-label="${escapeHtml(labels.previousPage)}">‹</button><button class="page-button" data-skill-page="next" title="${escapeHtml(labels.nextPage)}" aria-label="${escapeHtml(labels.nextPage)}">›</button></div>`;
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
    langZh: en ? 'Chinese' : '中文',
    langEn: 'English',
    refresh: en ? 'Refresh Scan' : '刷新扫描',
    loading: en ? 'Loading local governance data' : '正在读取本机治理数据',
    loadingTitle: en ? '3D scan core warming up' : '3D 扫描核心正在预热',
    loadingText: en ? 'Reading catalog, usage cache, session index, and graph signals. No AIDE files are modified.' : '正在读取 catalog、使用缓存、会话索引和图谱信号。不会修改 AIDE 文件。',
    cubeScan: en ? 'SCAN' : '扫描',
    cubeRisk: en ? 'RISK' : '风险',
    cubeLock: en ? 'LOCK' : '锁定',
    cubeMcp: en ? 'MCP' : 'MCP',
    cubeSkill: en ? 'SKILL' : '技能',
    cubeGraph: en ? 'GRAPH' : '图谱',
    readyTitle: en ? 'Local governance data is ready' : '本机治理数据已就绪',
    readyText: en ? 'Drag nodes, rotate or zoom the graph, or run a read-only command below.' : '可拖动节点、旋转或缩放图谱，也可在下方运行只读命令。',
    refreshingTitle: en ? 'Refreshing inventory' : '正在刷新清单',
    refreshingText: en ? 'Running the same read-only scan path as skm scan.' : '正在运行与 skm scan 相同的只读扫描路径。',
    localOnly: en ? 'local only · 127.0.0.1 · read-only phase' : '仅本机 · 127.0.0.1 · 第一阶段只读',
    navOverview: en ? 'Overview' : '总览',
    navSkills: en ? 'Skills' : 'Skill 清单',
    navGraph: en ? 'Knowledge Graph' : '知识图谱',
    navRecommend: en ? 'Recommendation' : '推荐',
    navCommands: en ? 'Command Center' : '命令中心',
    skillHint: en ? 'Filter installed skills, switch usage status, or sort by usage and context cost from the table headers. Hover a name to read its description.' : '筛选已安装 skill，切换使用状态，或点击表头按使用次数、上下文开销排序；悬停名称可查看描述。',
    filterPlaceholder: en ? 'Filter skills...' : '筛选 skill...',
    usageFilter: en ? 'Usage status' : '使用状态',
    usageAll: en ? 'All skills' : '全部',
    usageInUse: en ? 'In use' : '在使用',
    usageUnused: en ? 'Unused' : '未使用',
    previousPage: en ? 'Previous page' : '上一页',
    nextPage: en ? 'Next page' : '下一页',
    totalPrefix: en ? 'Total' : '共',
    pageSummary: en ? 'items · page' : '条 · 第',
    pageOf: en ? 'of' : '/',
    pageEnd: en ? '' : ' 页',
    sourceTooltipTitle: en ? 'Recorded source addresses' : '已记录的来源地址',
    skillDescriptionTitle: en ? 'Skill description' : 'Skill 描述',
    skillNoDescription: en ? 'No description recorded.' : '未记录描述。',
    graphHint: en ? 'Filter relations on the left. Drag a node to reposition it, drag empty space to rotate, and scroll to zoom.' : '左侧筛选关系；拖动节点可调整位置，拖动空白处可旋转，滚轮可缩放。',
    graphSearch: en ? 'Search nodes...' : '搜索图谱节点...',
    graphEdgeFilter: en ? 'Relation filters' : '关系过滤',
    graphScopeFilter: en ? 'Focus scope' : '聚焦范围',
    graphScopeAll: en ? 'All suites, platforms, and categories' : '全部套件、平台与分类',
    graphScopeSuites: en ? 'Suites inferred from prefixes' : '目录前缀推断的套件',
    graphScopePlatforms: en ? 'Platforms inferred from keywords' : '关键词推断的平台',
    graphScopeCategories: en ? 'Classification categories' : '分类规则产生的分类',
    graphScopeHint: en ? 'Choose one concrete scope to isolate its members and their enabled relationships.' : '选择具体范围后，只显示其成员及成员间已启用的关系。',
    graphGroupMembership: en ? 'Membership' : '归属结构',
    graphGroupRisk: en ? 'Overlap and cleanup' : '重叠与清理',
    graphGroupWorkflow: en ? 'Workflow signals' : '工作流线索',
    graphGroupDependency: en ? 'Platform and dependencies' : '平台与依赖',
    graphDetailEmpty: en ? 'Select a node to inspect its attributes and relationships.' : '选择节点后查看属性及关联关系。',
    graphNodes: en ? 'nodes' : '节点',
    graphEdges: en ? 'edges' : '连线',
    graphRelated: en ? 'Relationships' : '关联数',
    graphEmpty: en ? 'No nodes match the current relation filters.' : '当前关系筛选下没有可显示的节点。',
    graphReset: en ? 'Reset view' : '恢复全图',
    graphInsightSuite: en ? 'Suites' : '套件分组',
    graphInsightSuiteHint: en ? 'Review grouped installs and suite boundaries' : '检查成组安装与套件边界',
    graphInsightOverlap: en ? 'Overlaps' : '功能重叠',
    graphInsightOverlapHint: en ? 'Compare alternatives before cleanup' : '清理前比较替代能力',
    graphInsightFlow: en ? 'Workflows' : '可串联流程',
    graphInsightFlowHint: en ? 'Discover reusable task chains' : '发现可复用任务链路',
    graphInsightDependency: en ? 'MCP links' : 'MCP 依赖',
    graphInsightDependencyHint: en ? 'Verify inferred external dependencies' : '核对推断出的外部依赖',
    graphFocusNeighbors: en ? 'Focus one-hop relationships' : '聚焦一跳关系',
    graphLocateSkill: en ? 'Locate in skill inventory' : '在 Skill 清单中定位',
    graphSuggestedCommands: en ? 'Suggested commands' : '建议操作',
    graphRelationshipEvidence: en ? 'Relationship evidence' : '关系证据',
    graphConfidenceExplicit: en ? 'explicit' : '明确',
    graphConfidenceStructural: en ? 'structural' : '结构',
    graphConfidenceInferred: en ? 'inferred' : '推断',
    graphNodeSkill: en ? 'Skill' : 'Skill',
    graphNodeMcp: en ? 'MCP' : 'MCP',
    graphNodeCategory: en ? 'Category' : '分类',
    graphNodeFamily: en ? 'Suite' : '套件',
    graphNodePlatform: en ? 'Platform' : '平台',
    recommendHint: en ? 'Describe a task and get local recommendations without calling an external model.' : '描述任务后，用本地规则推荐合适 skill，不调用外部模型。',
    recommendPlaceholder: en ? 'e.g. convert a web page to markdown' : '例如：把网页转成 markdown',
    recommendButton: en ? 'Recommend' : '推荐',
    commandHint: en ? 'Read-only commands run locally and show output in an embedded terminal. Other commands remain copy-only with parameter guidance.' : '只读命令可在本机运行并在卡片终端展示结果；其他命令保留复制能力并提供参数说明。',
    cmdRun: en ? 'Run' : '运行',
    copyCommand: en ? 'Copy command' : '复制命令',
    cmdParameters: en ? 'Parameters' : '参数',
    cmdNoParameters: en ? 'No additional parameters' : '无需附加参数',
    cmdHelp: en ? 'Parameters and examples' : '参数说明与示例',
    cmdLoading: en ? 'Running locally...' : '正在本机运行...',
    cmdNoOutput: en ? '(No output)' : '（无输出）',
    cmdError: en ? 'Command failed' : '命令执行失败',
    loadingFallbackTitle: en ? 'Loading local governance data' : '正在读取本机治理数据',
    loadingFallbackText: en ? 'Reading catalog, usage cache, session index, and graph signals. No AIDE files are modified.' : '正在读取 catalog、使用缓存、会话索引和图谱信号。不会修改 AIDE 文件。',
    refreshingFallbackTitle: en ? 'Refreshing inventory' : '正在刷新清单',
    refreshingFallbackText: en ? 'Running the same read-only scan path as skm scan.' : '正在运行与 skm scan 相同的只读扫描路径。',
    loadFailed: en ? 'Load failed' : '加载失败',
    skillMetricTitle: en ? 'Skills' : 'Skill 总量',
    mcpMetricTitle: en ? 'MCP servers' : 'MCP 总量',
    terminalScore: en ? 'score' : '得分',
    terminalSkills: en ? 'skills' : 'skill',
    terminalMcp: en ? 'MCP' : 'MCP',
    terminalCatalog: en ? 'catalog' : '目录',
    dryRunBadge: en ? 'dry-run' : 'dry-run',
    readonly: en ? 'read-only' : '只读',
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
    noSkills: en ? 'No installed skills were found.' : '没有扫描到已安装的 skill。',
    noMatch: en ? 'No skills match this filter.' : '没有符合当前筛选条件的 skill。',
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function zh(lang, zhText, enText) {
  return lang === 'en' ? enText : zhText;
}
