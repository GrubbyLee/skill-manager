import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { mergeByDirName } from '../catalog.js';
import { buildOverview } from '../overview.js';
import { buildSessionIndex } from '../sessionsIndex.js';
import { buildUsageLookup, scanUsage } from '../usage.js';
import { paint } from '../utils.js';
import { runScan, runScanLocal, ensureCatalog } from './scan.js';
import { buildKnowledgeGraph, edgeReason } from './graph.js';
import { buildReportData } from './report.js';
import { rankRecommendations } from './recommend.js';
import { discoverSkillSources } from '../sourceDiscovery.js';
import { applySourcesToSkills, isValidSourceUrl, upsertSource } from '../sources.js';
import { installationId } from '../skillPackage.js';

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
    console.log(zh(lang, '本地治理工作台已启动；来源写入和联网检查都需要页面内显式确认，关闭终端进程即可停止服务。', 'Local governance dashboard is ready; source writes and network checks require explicit in-page confirmation. Stop the terminal process to shut it down.'));
  });
  server.on('error', (e) => {
    console.error(zh(lang, `Web 服务启动失败：${e.message}`, `Failed to start the web server: ${e.message}`));
    process.exitCode = 1;
  });
}

export function createWebServer({ cwd, lang = 'zh-CN', port = DEFAULT_PORT, services = null }) {
  const webServices = services || createWebServices({ cwd });
  const discoverySessions = new Map();
  return http.createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host, port)) return sendJson(res, 403, { error: 'forbidden_host' });
      const url = new URL(req.url || '/', `http://${HOST}`);
      const requestLang = resolveWebLang(url.searchParams.get('lang'), lang);
      if (url.pathname.startsWith('/api/') && !isAllowedApiRequest(req, port)) return sendJson(res, 403, { error: 'forbidden_origin' });
      if (req.method === 'GET') {
        if (url.pathname === '/') return sendHtml(res, renderWebHtml(requestLang));
        if (url.pathname === '/app.js') return sendJavaScript(res, loadWebClient());
        if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') return sendFavicon(res);
        if (url.pathname === '/api/dashboard') return sendJson(res, 200, collectDashboard({ cwd, lang: requestLang, refresh: url.searchParams.get('refresh') === '1' }));
        if (url.pathname === '/api/recommend') return sendJson(res, 200, collectRecommendation({ cwd, lang: requestLang, query: url.searchParams.get('q') || '', top: url.searchParams.get('top') || '5' }));
        if (url.pathname === '/api/run') return runReadonlyCommand({ cwd, lang: requestLang, cmd: url.searchParams.get('cmd') || '', args: url.searchParams.get('args') || '' }, res);
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (url.pathname === '/api/versions/check') {
          await webServices.checkVersions({ lang: requestLang, refresh: body.refresh === true });
          return sendJson(res, 200, { ok: true, dashboard: collectDashboard({ cwd, lang: requestLang }) });
        }
        if (url.pathname === '/api/sources/manual') {
          const skill = validSkillName(body.skill);
          const source = validSourceAddress(body.source);
          const instanceIds = validInstanceIds(body.instanceIds);
          const result = await webServices.saveSource({ skill, instanceIds, input: manualSourceInput(source) });
          return sendJson(res, 200, { ok: true, ...result, dashboard: collectDashboard({ cwd, lang: requestLang }) });
        }
        if (url.pathname === '/api/sources/discover') {
          if (body.consent !== true) throw new WebRequestError('search_consent_required');
          const skill = validSkillName(body.skill);
          let result;
          try {
            result = await webServices.discoverSource({ skill });
          } catch (error) {
            throw new WebRequestError(`source_search_failed: ${error.message || error}`, 502);
          }
          pruneDiscoverySessions(discoverySessions);
          const sessionId = crypto.randomUUID();
          discoverySessions.set(sessionId, { skill, result, createdAt: Date.now() });
          return sendJson(res, 200, { sessionId, provider: result.provider, searchedAt: result.searchedAt, candidates: publicDiscoveryCandidates(result.candidates) });
        }
        if (url.pathname === '/api/sources/confirm') {
          const sessionId = String(body.sessionId || '');
          const session = discoverySessions.get(sessionId);
          if (!session || Date.now() - session.createdAt > 10 * 60 * 1000) throw new WebRequestError('discovery_session_expired');
          const candidateIndex = Number(body.candidateIndex);
          if (!Number.isInteger(candidateIndex) || !session.result.candidates[candidateIndex]) throw new WebRequestError('invalid_candidate');
          const instanceIds = validInstanceIds(body.instanceIds);
          const input = discoveredSourceInput(session.result.candidates[candidateIndex], session.result);
          const result = await webServices.saveSource({ skill: session.skill, instanceIds, input });
          discoverySessions.delete(sessionId);
          return sendJson(res, 200, { ok: true, ...result, dashboard: collectDashboard({ cwd, lang: requestLang }) });
        }
        if (url.pathname === '/api/update/preview') {
          const skill = validSkillName(body.skill);
          const instanceId = validInstanceIds([body.instanceId])[0];
          return sendJson(res, 200, await webServices.previewUpdate({ skill, instanceId, lang: requestLang }));
        }
      }
      if (!['GET', 'POST'].includes(req.method || '')) return sendJson(res, 405, { error: 'method_not_allowed' });
      return sendJson(res, 404, { error: 'not_found' });
    } catch (e) {
      const status = e instanceof WebRequestError ? e.statusCode : 500;
      sendJson(res, status, { error: e instanceof WebRequestError ? e.code : 'internal_error', message: e.message || String(e) });
    }
  });
}

export function createWebServices({ cwd }) {
  return {
    async checkVersions({ lang, refresh }) {
      await runScan({ cwd, quiet: true, online: true, refresh, lang });
    },
    async discoverSource({ skill }) {
      return discoverSkillSources(skill, { provider: 'github' });
    },
    async saveSource({ skill, instanceIds, input }) {
      return saveWebSource({ cwd, skill, instanceIds, input });
    },
    async previewUpdate({ skill, instanceId, lang }) {
      return previewWebUpdate({ cwd, skill, instanceId, lang });
    },
  };
}

function saveWebSource({ cwd, skill, instanceIds, input }) {
  const catalog = ensureCatalog(cwd);
  const matches = applySourcesToSkills(catalog.skills || []).filter((entry) => entry.dirName === skill || entry.name === skill);
  if (!matches.length) throw new WebRequestError('skill_not_found');
  const byId = new Map(matches.map((entry) => [entry.id || installationId(entry), entry]));
  const selected = instanceIds.map((id) => byId.get(id));
  if (selected.some((entry) => !entry)) throw new WebRequestError('invalid_instance');
  if (selected.some((entry) => entry.upstream && (entry.upstream.source || entry.upstream.repository || entry.upstream.homepage || entry.upstream.git?.remote))) {
    throw new WebRequestError('source_already_tracked');
  }
  for (const entry of selected) upsertSource(skill, input, { instanceId: entry.id || installationId(entry) });
  if (matches.length === 1) upsertSource(skill, input);
  runScanLocal({ cwd, silent: true, quiet: true });
  return { skill, saved: selected.length };
}

function previewWebUpdate({ cwd, skill, instanceId, lang }) {
  const catalog = ensureCatalog(cwd, lang);
  const matches = applySourcesToSkills(catalog.skills || []).filter((entry) => entry.dirName === skill || entry.name === skill);
  const target = matches.find((entry) => (entry.id || installationId(entry)) === instanceId);
  if (!target) throw new WebRequestError('invalid_instance');
  const argv = ['update', skill, '--instance', instanceId, '--dry-run'];
  const proc = spawnSync(process.execPath, [CLI_ENTRY, ...argv], {
    cwd, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, SKM_LANG: lang },
  });
  return {
    command: `skm ${argv.join(' ')}`,
    exitCode: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
  };
}

function manualSourceInput(source) {
  return {
    source,
    note: 'manual',
    discovery: { method: 'manual', confirmedByUser: true },
  };
}

function discoveredSourceInput(candidate, result) {
  return {
    source: candidate.source,
    repository: candidate.repositoryUrl,
    version: candidate.version,
    ref: candidate.ref,
    subdir: candidate.subdir,
    note: 'discovered',
    discovery: {
      method: 'search',
      provider: result.provider,
      query: result.query,
      confidence: candidate.confidence,
      verifiedAt: result.searchedAt,
      confirmedByUser: true,
      candidatePath: candidate.path,
    },
  };
}

function publicDiscoveryCandidates(candidates = []) {
  return candidates.map((candidate, index) => ({
    index,
    name: candidate.name,
    description: candidate.description,
    source: candidate.source,
    repository: candidate.repository,
    repositoryUrl: candidate.repositoryUrl,
    path: candidate.path,
    version: candidate.version,
    confidence: candidate.confidence,
    verified: candidate.verified === true,
  }));
}

function pruneDiscoverySessions(sessions) {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, session] of sessions) if (session.createdAt < cutoff) sessions.delete(id);
}

function validSkillName(value) {
  const skill = String(value || '').trim();
  if (!skill || skill.length > 200 || /[\u0000-\u001f]/.test(skill)) throw new WebRequestError('invalid_skill');
  return skill;
}

function validSourceAddress(value) {
  const source = String(value || '').trim();
  if (!source || source.length > 4096 || !isValidSourceUrl(source)) throw new WebRequestError('invalid_source');
  return source;
}

function validInstanceIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) throw new WebRequestError('instances_required');
  const ids = [...new Set(value.map((item) => String(item || '').trim()))];
  if (ids.some((id) => !id || id.length > 500 || /[\u0000-\u001f]/.test(id))) throw new WebRequestError('invalid_instance');
  return ids;
}

async function readJsonBody(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new WebRequestError('json_required', 415);
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 32 * 1024) throw new WebRequestError('request_too_large', 413);
  }
  try {
    const parsed = JSON.parse(body || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new WebRequestError('invalid_json');
  }
}

class WebRequestError extends Error {
  constructor(code, statusCode = 400) {
    super(code);
    this.name = 'WebRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
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
  if (refresh) runScanLocal({ cwd, silent: true, quiet: true, lang });
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
        const instances = webSkillInstances(skill);
        const sourceCount = instances.filter((instance) => instance.hasSource).length;
        const sourceStatus = sourceCount === instances.length ? 'tracked' : sourceCount ? 'partial' : 'missing';
        const freshness = aggregateFreshness(instances);
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
          hasSource: sourceStatus === 'tracked',
          hasAnySource: sourceCount > 0,
          sourceStatus,
          sources,
          instances,
          freshness,
          updateTargets: instances.filter((instance) => ['outdated', 'diverged'].includes(instance.freshness.status)).map((instance) => ({
            instanceId: instance.instanceId,
            tool: instance.tool,
            scope: instance.scope,
            status: instance.freshness.status,
            currentVersion: instance.currentVersion,
            remoteVersion: instance.freshness.remoteVersion,
          })),
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

function webSkillInstances(skill) {
  return (skill.entries || [skill]).map((entry) => {
    const sources = entrySourceUrls(entry);
    const upstream = entry.upstream || {};
    const sourceDiscovery = publicSourceDiscovery(upstream.sourceDiscovery);
    return {
      instanceId: entry.id || installationId(entry),
      tool: entry.tool || null,
      scope: entry.scope || null,
      currentVersion: upstream.version || null,
      hasSource: sources.length > 0,
      sources,
      sourceDiscovery,
      freshness: normalizeWebFreshness(entry, sources.length > 0),
    };
  });
}

function entrySourceUrls(entry) {
  const upstream = entry.upstream || {};
  return [...new Set([
    upstream.source,
    upstream.repository,
    upstream.homepage,
    upstream.git?.remote,
    ...(Array.isArray(upstream.urls) ? upstream.urls : []),
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => redactSourceAddress(value.trim())))];
}

function publicSourceDiscovery(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    method: value.method || null,
    provider: value.provider || null,
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : null,
    verifiedAt: value.verifiedAt || null,
    confirmedByUser: value.confirmedByUser === true,
    candidatePath: value.candidatePath || null,
  };
}

function normalizeWebFreshness(entry, hasSource) {
  const value = entry.upstreamFreshness;
  if (value && typeof value === 'object' && value.status) {
    return {
      status: value.status,
      checkedAt: value.checkedAt || null,
      cached: value.cached === true,
      remoteVersion: value.remoteVersion || null,
      remoteCommit: value.remoteCommit || null,
      remotePackageHash: value.remotePackageHash || null,
    };
  }
  return {
    status: hasSource ? 'unchecked' : entry.upstream?.version ? 'unknown' : 'untracked',
    checkedAt: null,
    cached: false,
    remoteVersion: null,
    remoteCommit: null,
    remotePackageHash: null,
  };
}

function aggregateFreshness(instances) {
  const order = { outdated: 0, diverged: 1, unknown: 2, unchecked: 3, untracked: 4, ahead: 5, latest: 6 };
  const selected = instances
    .map((instance) => instance.freshness)
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))[0];
  return selected || { status: 'untracked', checkedAt: null, cached: false, remoteVersion: null };
}

export function skillSourceUrls(skill) {
  return [...new Set((skill.entries || [skill]).flatMap(entrySourceUrls))];
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
  const tools = ['claude-code', 'codex', 'cursor', 'gemini', 'workbuddy', 'kimi'];
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
    // ── 总览诊断 ──────────────────────────────────────
    { id: "status", group: "diagnosis", icon: "dashboard", command: "skm",
      description: en ? "Show the grouped governance overview" : "查看总分结构治理总览",
      mode: "read", executable: true,
      params: [],
      examples: ["skm"],
      hint: en ? "Reads the existing catalog, usage cache, and session index to show a domain-by-domain summary." : "读取已有 catalog、使用缓存和会话索引，按治理分域展示摘要。" },
    { id: "scan", group: "diagnosis", icon: "radar", command: "skm scan",
      description: en ? "Refresh inventory facts and rebuild the catalog" : "刷新事实清单并重建 catalog",
      mode: "read", executable: true,
      params: [
        { flag: "--verbose", label: en ? "verbose" : "详细", type: "bool", hint: en ? "Show per-category breakdown" : "显示逐分类明细" }
      ],
      examples: ["skm scan", "skm scan --verbose"],
      hint: en ? "Rebuilds the catalog from AIDE skill / MCP directories and refreshes the governance overview." : "从 AIDE skill/MCP 目录重建 catalog，并刷新治理总览。" },
    { id: "doctor", group: "diagnosis", icon: "stethoscope", command: "skm doctor",
      description: en ? "Diagnose environment and local prerequisites" : "诊断环境和本机依赖状态",
      mode: "read", executable: true,
      params: [
        { flag: "--json", label: "JSON", type: "bool", hint: en ? "Machine-readable output" : "机器可读输出" }
      ],
      examples: ["skm doctor"],
      hint: en ? "Checks Node version, zero-dependency integrity, data directories, and optional advisor CLI availability." : "检查 Node 版本、零依赖完整性、数据目录、可选 advisor CLI 可用性。" },
    { id: "risks", group: "diagnosis", icon: "shield", command: "skm risks",
      description: en ? "Inspect duplicate, idle, context, and log risks" : "查看重复、闲置、上下文和日志风险",
      mode: "read", executable: true,
      params: [
        { flag: "--json", label: "JSON", type: "bool", hint: en ? "Machine-readable output" : "机器可读输出" }
      ],
      examples: ["skm risks"],
      hint: en ? "Read-only risk report: duplicates, idle skills, context cost, MCP schema estimate, and session log size." : "只读风险报告：重复、闲置 skill、上下文开销、MCP schema 估算、会话日志体积。" },

    // ── 探查检索 ──────────────────────────────────────
    { id: "list", group: "explore", icon: "list", command: "skm list",
      description: en ? "List all skills by category" : "按分类查看所有 skill",
      mode: "read", executable: true,
      params: [
        { flag: "--tool", label: en ? "tool" : "工具", type: "value", values: ["claude", "codex", "cursor", "gemini", "workbuddy", "kimi"], hint: en ? "Filter by client tool" : "按客户端工具筛选" },
        { flag: "--category", label: en ? "category" : "分类", type: "value", hint: en ? "Filter by category keyword" : "按分类关键词筛选" },
        { flag: "--mcp", label: "MCP", type: "bool", hint: en ? "List MCP servers instead" : "列出 MCP server" },
        { flag: "--raw", label: en ? "raw" : "原始", type: "bool", hint: en ? "Raw table output" : "原始表格输出" }
      ],
      examples: ["skm list", "skm list --tool claude", "skm list --mcp"],
      hint: en ? "Supports filtering by tool, category, and scope. Use --mcp to list MCP servers instead." : "支持按工具、分类、范围过滤；--mcp 列出 MCP server。" },
    { id: "search", group: "explore", icon: "search", command: "skm search <keyword>",
      description: en ? "Search skills by name, category, and description" : "按名称、分类和描述搜索 skill",
      mode: "read", executable: true,
      params: [
        { flag: "<keyword>", label: en ? "keyword" : "关键词", type: "positional", hint: en ? "One or more keywords" : "一个或多个关键词" }
      ],
      examples: ["skm search markdown"],
      hint: en ? "Fuzzy matches against skill name, category, and description; results are sorted by relevance." : "在名称、分类、描述中模糊匹配，按相关度排序。" },
    { id: "ask", group: "explore", icon: "sparkles", command: 'skm ask "task"',
      description: en ? "Recommend skills for a natural-language task" : "按自然语言任务推荐 skill",
      mode: "read", executable: false,
      params: [
        { flag: "<task>", label: en ? "task" : "任务", type: "positional", hint: en ? "Describe what you want to do" : "描述你想做什么" }
      ],
      examples: ['skm ask "convert web page to markdown"'],
      hint: en ? "Use the Recommendation section above for interactive recommendations." : "推荐功能在页面上方「智能推荐」区，可直接交互。" },
    { id: "dupes", group: "explore", icon: "copy", command: "skm dupes",
      description: en ? "Detect duplicate and near-duplicate skills" : "检测重复和近似重复 skill",
      mode: "read", executable: false,
      params: [
        { flag: "--json", label: "JSON", type: "bool", hint: en ? "Machine-readable output" : "机器可读输出" }
      ],
      examples: ["skm dupes"],
      hint: en ? "Four levels: same-name, strong alternative, weak alternative, and same-category overlap." : "四级检测：同名、强备选、弱备选、同类重叠。" },

    // ── 使用审计 ──────────────────────────────────────
    { id: "audit", group: "audit", icon: "chart", command: "skm audit",
      description: en ? "Audit usage frequency and static safety findings" : "审计真实使用频率和静态安全发现",
      mode: "read", executable: true,
      params: [
        { flag: "--json", label: "JSON", type: "bool", hint: en ? "Machine-readable output" : "机器可读输出" },
        { flag: "--history", label: en ? "history" : "历史", type: "bool", hint: en ? "Show trend snapshots" : "显示趋势快照" }
      ],
      examples: ["skm audit", "skm audit --json"],
      hint: en ? "Usage frequency, zombie skills, MCP usage, context cost, and static security audit." : "使用频率、僵尸 skill、MCP 使用、上下文开销、静态安全审计；快照自动归档。" },
    { id: "sessions", group: "audit", icon: "clock", command: "skm sessions",
      description: en ? "Show session log distribution and cleanup plan" : "查看会话日志分布和清理计划",
      mode: "read", executable: true,
      params: [
        { flag: "--clean", label: en ? "clean" : "清理", type: "bool", hint: en ? "Run cleanup (use with --dry-run first)" : "执行清理（先 --dry-run）" },
        { flag: "--days", label: en ? "days" : "天数", type: "value", hint: en ? "Keep sessions within N days" : "保留 N 天内的会话" },
        { flag: "--keep", label: en ? "keep" : "保留", type: "value", hint: en ? "Min sessions per workspace" : "每个工作区最少保留数" },
        { flag: "--dry-run", label: "dry-run", type: "bool", hint: en ? "Preview plan only" : "仅预览计划" }
      ],
      examples: ["skm sessions", "skm sessions --clean --days 30 --keep 3 --dry-run"],
      hint: en ? "Read-only by default. Cleanup parameters are accepted in the Web console only when --dry-run is present." : "默认只读；Web 工作台只允许带 --dry-run 的清理参数，仅生成预览计划。" },
    { id: "sources", group: "audit", icon: "link", command: "skm sources",
      description: en ? "List upstream sources for installed skills" : "列出已安装 skill 的上游来源",
      mode: "read", executable: false,
      params: [
        { flag: "missing", label: en ? "missing" : "缺失", type: "subcommand", hint: en ? "Show skills without a known source" : "显示来源不明的 skill" }
      ],
      examples: ["skm sources", "skm sources missing"],
      hint: en ? "Tracks GitHub URLs, npm packages, and local paths recorded at install time." : "追踪安装时记录的 GitHub 地址、npm 包、本地路径。" },
    { id: "outdated", group: "audit", icon: "download", command: "skm outdated",
      description: en ? "Check for newer versions of installed skills" : "检查已安装 skill 的新版本",
      mode: "read", executable: false,
      params: [
        { flag: "--json", label: "JSON", type: "bool", hint: en ? "Machine-readable output" : "机器可读输出" }
      ],
      examples: ["skm outdated"],
      hint: en ? "Compares local version clues against upstream registry / repository." : "对比本地版本线索与上游仓库/注册表。" },

    // ── 生命周期治理 ──────────────────────────────────
    { id: "install", group: "lifecycle", icon: "plus", command: "skm install <source> --dry-run",
      description: en ? "Preview a skill install plan" : "预览 skill 安装计划",
      mode: "dry-run", executable: false,
      params: [
        { flag: "<source>", label: en ? "source" : "来源", type: "positional", hint: en ? "URL, npm path, or local directory" : "URL、npm 包或本地目录" },
        { flag: "--tool", label: en ? "tool" : "工具", type: "value", values: ["claude", "codex", "cursor", "gemini", "workbuddy", "kimi"], hint: en ? "Target client tool" : "目标客户端" },
        { flag: "--dry-run", label: "dry-run", type: "bool", hint: en ? "Preview plan only" : "仅预览计划" },
        { flag: "--yes", label: "yes", type: "bool", hint: en ? "Skip confirmation" : "跳过确认" }
      ],
      examples: ["skm install ./my-skill --tool claude --dry-run"],
      hint: en ? "Write action. Always run with --dry-run first." : "写操作。先加 --dry-run 看计划，确认无误后去掉再执行。" },
    { id: "update", group: "lifecycle", icon: "refresh", command: "skm update <skill> --dry-run",
      description: en ? "Preview a skill update plan" : "预览 skill 更新计划",
      mode: "dry-run", executable: false,
      params: [
        { flag: "<skill>", label: "skill", type: "positional", hint: en ? "Skill name to update" : "要更新的 skill 名称" },
        { flag: "--tool", label: en ? "tool" : "工具", type: "value", values: ["claude", "codex", "cursor", "gemini", "workbuddy", "kimi"], hint: en ? "Target client tool" : "目标客户端" },
        { flag: "--dry-run", label: "dry-run", type: "bool", hint: en ? "Preview plan only" : "仅预览计划" },
        { flag: "--yes", label: "yes", type: "bool", hint: en ? "Skip confirmation" : "跳过确认" }
      ],
      examples: ["skm update baoyu-image-gen --dry-run"],
      hint: en ? "Write action. Backs up old directory; --dry-run recommended first." : "写操作。更新前备份旧目录；建议先 --dry-run。" },
    { id: "rollback", group: "lifecycle", icon: "undo", command: "skm rollback <skill> --dry-run",
      description: en ? "Preview a skill rollback plan" : "预览 skill 回滚计划",
      mode: "dry-run", executable: false,
      params: [
        { flag: "<skill>", label: "skill", type: "positional", hint: en ? "Skill name to roll back" : "要回滚的 skill 名称" },
        { flag: "--tool", label: en ? "tool" : "工具", type: "value", values: ["claude", "codex", "cursor", "gemini", "workbuddy", "kimi"], hint: en ? "Target client tool" : "目标客户端" },
        { flag: "--dry-run", label: "dry-run", type: "bool", hint: en ? "Preview plan only" : "仅预览计划" },
        { flag: "--yes", label: "yes", type: "bool", hint: en ? "Skip confirmation" : "跳过确认" }
      ],
      examples: ["skm rollback baoyu-image-gen --dry-run"],
      hint: en ? "Write action. Restores from backup; backs up current state before rollback." : "写操作。从 skm 备份恢复；回滚前再备份当前状态；先 --dry-run。" },
    { id: "disable", group: "lifecycle", icon: "pause", command: "skm disable <skill> --dry-run",
      description: en ? "Preview a soft-disable action" : "预览软禁用操作",
      mode: "dry-run", executable: false,
      params: [
        { flag: "<skill>", label: "skill", type: "positional", hint: en ? "Skill name to disable" : "要禁用的 skill 名称" },
        { flag: "--mcp", label: "MCP", type: "value", hint: en ? "MCP server name" : "MCP server 名称" },
        { flag: "--dry-run", label: "dry-run", type: "bool", hint: en ? "Preview plan only" : "仅预览计划" }
      ],
      examples: ["skm disable gsap-plugins --dry-run", "skm disable --mcp drawio --dry-run"],
      hint: en ? "Write action. Renames directories or edits MCP config. --dry-run shows plan only." : "写操作。重命名目录或修改 MCP 配置；--dry-run 只看计划，不改动。" },
    { id: "enable", group: "lifecycle", icon: "play", command: "skm enable",
      description: en ? "List restorable disabled items or restore one" : "查看可恢复的禁用项或恢复某项",
      mode: "read", executable: false,
      params: [
        { flag: "[skill]", label: "skill", type: "positional", hint: en ? "Skill name to restore (optional)" : "要恢复的 skill 名称（可选）" },
        { flag: "--mcp", label: "MCP", type: "value", hint: en ? "MCP server name" : "MCP server 名称" },
        { flag: "--dry-run", label: "dry-run", type: "bool", hint: en ? "Preview plan only" : "仅预览计划" }
      ],
      examples: ["skm enable", "skm enable gsap-plugins --dry-run"],
      hint: en ? "Without arguments, lists disabled items. Named restore supports --dry-run on CLI." : "不带参数列出已禁用项；带名称恢复时，命令行支持 --dry-run。" },
    { id: "lock", group: "lifecycle", icon: "lock", command: "skm lock",
      description: en ? "Pin a skill to prevent accidental updates" : "锁定 skill 防止意外更新",
      mode: "dry-run", executable: false,
      params: [
        { flag: "<skill>", label: "skill", type: "positional", hint: en ? "Skill name to lock/unlock" : "要锁定的 skill 名称" },
        { flag: "--unlock", label: en ? "unlock" : "解锁", type: "bool", hint: en ? "Remove lock" : "移除锁定" }
      ],
      examples: ["skm lock baoyu-image-gen"],
      hint: en ? "Locked skills are skipped by update and rollback commands." : "被锁定的 skill 在 update / rollback 时会被跳过。" },
    { id: "policy", group: "lifecycle", icon: "sliders", command: "skm policy",
      description: en ? "Define and check governance policy thresholds" : "定义和检查治理策略阈值",
      mode: "read", executable: false,
      params: [
        { flag: "init", label: en ? "init" : "初始化", type: "subcommand", hint: en ? "Create default policy file" : "创建默认策略文件" },
        { flag: "check", label: en ? "check" : "检查", type: "subcommand", hint: en ? "Validate against policy" : "按策略校验" }
      ],
      examples: ["skm policy check"],
      hint: en ? "Run policy init once to create thresholds, then policy check." : "先 policy init 建默认阈值，再 policy check 检查。" },
    { id: "eval", group: "lifecycle", icon: "star", command: "skm eval --all",
      description: en ? "Evaluate skill quality and cleanup priority" : "评测 skill 质量和整理优先级",
      mode: "read", executable: false,
      params: [
        { flag: "[skill]", label: "skill", type: "positional", hint: en ? "Single skill (optional)" : "单个 skill（可选）" },
        { flag: "--all", label: en ? "all" : "全部", type: "bool", hint: en ? "Evaluate all skills" : "评测全部 skill" },
        { flag: "--json", label: "JSON", type: "bool", hint: en ? "Machine-readable output" : "机器可读输出" }
      ],
      examples: ["skm eval --all"],
      hint: en ? "Quality scoring: description completeness, freshness, usage, security findings." : "从描述完整度、版本线索、使用频率、安全发现等维度打分。" },
    { id: "graph", group: "lifecycle", icon: "graph", command: "skm graph --format html",
      description: en ? "Export the full knowledge graph" : "导出完整知识图谱",
      mode: "read", executable: false,
      params: [
        { flag: "--format", label: en ? "format" : "格式", type: "value", values: ["html", "json"], hint: en ? "Output format" : "输出格式" },
        { flag: "--output", label: en ? "output" : "输出", type: "value", hint: en ? "Output file path" : "输出文件路径" }
      ],
      examples: ["skm graph --format html --output skill-graph.html"],
      hint: en ? "The graph section above already supports filtering, search, and drag." : "页面上方知识图谱已支持过滤、搜索、拖动；完整 HTML 用命令行导出。" },
    { id: "report", group: "lifecycle", icon: "file", command: "skm report --format html",
      description: en ? "Export a one-page HTML report" : "导出一页式 HTML 报告",
      mode: "read", executable: false,
      params: [
        { flag: "--format", label: en ? "format" : "格式", type: "value", values: ["html", "json", "summary"], hint: en ? "Output format" : "输出格式" },
        { flag: "--output", label: en ? "output" : "输出", type: "value", hint: en ? "Output file path" : "输出文件路径" },
        { flag: "--anonymize", label: en ? "anonymize" : "脱敏", type: "bool", hint: en ? "Remove personal paths" : "移除个人路径信息" }
      ],
      examples: ["skm report --format html --output skm-report.html"],
      hint: en ? "Exports health, risks, usage, sessions, and graph summary to a single HTML page." : "把健康分、风险、使用、会话、图谱汇总导出到单页 HTML。" },
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
.mark-logo { width:46px; height:46px; border-radius:13px; display:block; box-shadow:0 0 28px color-mix(in srgb, var(--accent) 32%, transparent); }
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
.skill-table { min-width:1160px; table-layout:fixed; }
.skill-table th:not(:first-child), .skill-table td:not(:first-child) { text-align:center; vertical-align:middle; }
.skill-table th:nth-child(1) { width:36%; }
.skill-table th:nth-child(2) { width:14%; }
.skill-table th:nth-child(3) { width:13%; }
.skill-table th:nth-child(4) { width:13%; }
.skill-table th:nth-child(5) { width:12%; }
.skill-table th:nth-child(6) { width:12%; }
.skill-table th:nth-child(7) { width:16%; }
.sort-button { display:inline-flex; align-items:center; justify-content:center; gap:5px; width:100%; padding:0; background:transparent; color:inherit; font-weight:inherit; }
.sort-button:hover, .sort-button.active { color:var(--text); }
.sort-indicator { width:14px; color:var(--accent); font-size:12px; }
.source-status { display:inline-flex; align-items:center; justify-content:center; min-width:62px; min-height:28px; padding:4px 9px; border:1px solid color-mix(in srgb, var(--accent) 34%, transparent); border-radius:6px; background:color-mix(in srgb, var(--accent) 12%, transparent); color:var(--text); font-size:12px; white-space:nowrap; cursor:help; }
.source-status.missing, .source-status.partial { border-color:color-mix(in srgb, var(--warn) 34%, transparent); background:color-mix(in srgb, var(--warn) 12%, transparent); color:var(--warn); cursor:pointer; }
.version-status { display:grid; gap:4px; justify-items:center; }
.version-status button { min-height:26px; padding:3px 7px; border:1px solid var(--line); border-radius:6px; background:transparent; color:var(--text); font-size:11px; cursor:pointer; }
.version-status button:hover { border-color:var(--accent); color:var(--accent); }
.version-status .pill { margin:0; }
.version-meta { color:var(--muted); font-size:10px; line-height:1.35; }
.source-provenance { display:grid; gap:4px; margin-top:8px; padding-top:8px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; line-height:1.45; }
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
.governance-modal { position:fixed; inset:0; z-index:90; display:flex; align-items:center; justify-content:center; padding:18px; background:rgba(4,8,16,.68); backdrop-filter:blur(16px); }
.governance-modal.hidden { display:none; }
.governance-dialog { width:min(720px, 96vw); max-height:88vh; overflow:auto; border:1px solid var(--line); border-radius:14px; background:var(--panel-strong); box-shadow:var(--shadow); padding:20px; }
.governance-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
.governance-head h3 { margin:0; font-size:18px; overflow-wrap:anywhere; }
.governance-head p { margin:5px 0 0; color:var(--muted); font-size:12px; line-height:1.5; }
.governance-close { width:36px; height:36px; border:1px solid var(--line); border-radius:7px; background:transparent; color:var(--text); font-size:18px; cursor:pointer; flex:0 0 auto; }
.governance-section { display:grid; gap:10px; padding:14px 0; border-top:1px solid var(--line); }
.governance-section h4 { margin:0; font-size:13px; }
.governance-section p { margin:0; color:var(--muted); font-size:12px; line-height:1.55; }
.governance-form { display:grid; gap:8px; }
.governance-form label { color:var(--muted); font-size:12px; }
.governance-form input[type="url"] { width:100%; min-height:40px; padding:0 11px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--text); }
.governance-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.governance-targets { display:grid; gap:6px; max-height:150px; overflow:auto; }
.governance-target { display:flex; align-items:center; gap:9px; min-height:36px; padding:7px 9px; border:1px solid var(--line); border-radius:7px; background:color-mix(in srgb, var(--panel) 72%, transparent); color:var(--text); font-size:12px; }
.governance-target input { accent-color:var(--accent); }
.candidate-list { display:grid; gap:7px; max-height:270px; overflow:auto; }
.candidate-option { display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px; align-items:start; padding:9px; border:1px solid var(--line); border-radius:8px; background:color-mix(in srgb, var(--panel) 76%, transparent); cursor:pointer; }
.candidate-option:has(input:checked) { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 10%, var(--panel)); }
.candidate-option input { margin-top:3px; accent-color:var(--accent); }
.candidate-option strong { display:block; font-size:12px; overflow-wrap:anywhere; }
.candidate-option small { display:block; margin-top:3px; color:var(--muted); line-height:1.4; overflow-wrap:anywhere; }
.governance-error { color:var(--warn); font-size:12px; line-height:1.45; }
.governance-success { color:var(--accent-3); font-size:12px; line-height:1.45; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
@keyframes cubeSpin { from { transform:rotateX(-22deg) rotateY(0deg) rotateZ(0deg); } to { transform:rotateX(338deg) rotateY(360deg) rotateZ(360deg); } }
@keyframes orbit { from { transform:rotateX(64deg) rotateZ(0deg); } to { transform:rotateX(64deg) rotateZ(360deg); } }
@keyframes sweep { from { transform:translateX(-90%); } to { transform:translateX(90%); } }
@media (max-width:1180px) { .graph-layout { grid-template-columns:190px minmax(0,1fr); } .graph-detail { grid-column:1 / -1; } .graph-insights { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:1040px) { .hero { grid-template-columns:1fr; } .layout { grid-template-columns:1fr; } .rail { position:relative; top:auto; display:flex; overflow:auto; } .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:680px) { html { scroll-padding-top:12px; } .shell, .topbar, .hero, .layout, .content, .card { max-width:100vw; min-width:0; } .topbar { position:relative; top:auto; align-items:flex-start; flex-direction:column; overflow:hidden; } .controls { width:100%; min-width:0; display:grid; grid-template-columns:1fr; gap:8px; } .lang-btn, .theme-btn, .action-btn { width:100%; min-width:0; padding:0 6px; font-size:14px; } .hero { grid-template-columns:minmax(0,1fr); overflow:hidden; } .hero-main { padding:22px; min-width:0; } .grid, .domains, .graph-layout, .graph-insights { grid-template-columns:1fr; } .wide { grid-column:1 / -1; } .hero h2 { font-size:28px; line-height:1.04; white-space:normal; } .graph-filters { max-height:250px; overflow:auto; } .graph-detail { grid-column:auto; } .graph-toolbar { align-items:stretch; flex-direction:column; } .graph-stats { white-space:normal; } .pagination { justify-content:space-between; } .governance-dialog { padding:16px; } .governance-actions .action-btn { width:auto; flex:1 1 160px; } }

/* ── 命令中心 ──────────────────────────────────── */
.pill.read { background:color-mix(in srgb, #10b981 18%, transparent); border-color:color-mix(in srgb, #10b981 30%, transparent); color:#6ee7b7; }
.cmd-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.cmd-search { width:200px; height:32px; padding:0 10px; border:1px solid var(--line); border-radius:7px; background:var(--panel-strong); color:var(--text); font-size:12px; }
.cmd-filter-tabs { display:flex; gap:4px; flex-wrap:wrap; }
.cmd-tab { padding:4px 11px; border:1px solid var(--line); border-radius:999px; background:transparent; color:var(--muted); font-size:11px; cursor:pointer; transition:.2s; }
.cmd-tab:hover { color:var(--text); border-color:var(--accent-3); }
.cmd-tab.active { color:var(--accent-1); border-color:var(--accent-1); background:color-mix(in srgb, var(--accent-1) 12%, transparent); }
.cmd-workflows { margin:14px 0 2px; }
.cmd-workflows-header { font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; margin-bottom:7px; }
.cmd-workflows-list { display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:9px; }
.workflow-card { padding:9px 11px; border:1px solid var(--line); border-radius:10px; background:linear-gradient(135deg, color-mix(in srgb, var(--accent-1) 8%, transparent), transparent); }
.workflow-title { font-weight:600; font-size:12px; margin-bottom:7px; color:var(--text); }
.workflow-steps { display:flex; flex-direction:column; gap:4px; }
.workflow-step { display:flex; align-items:center; gap:7px; padding:4px 7px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--text); font-size:11px; cursor:pointer; text-align:left; transition:.15s; }
.workflow-step:hover { border-color:var(--accent-1); color:var(--accent-1); }
.step-index { display:inline-flex; align-items:center; justify-content:center; width:17px; height:17px; border-radius:50%; background:var(--accent-1); color:#fff; font-size:10px; font-weight:700; flex-shrink:0; }
.step-cmd { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:10.5px; }
.command-groups { display:grid; gap:16px; }
.cmd-group { display:grid; gap:8px; }
.cmd-group-title { font-size:11.5px; color:var(--muted); margin:0; display:flex; align-items:center; gap:5px; letter-spacing:.02em; }
.cmd-group-count { font-size:10px; padding:1px 6px; border-radius:999px; background:var(--panel-strong); border:1px solid var(--line); color:var(--muted); }
.cmd-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:9px; }
.cmd-empty { padding:36px; text-align:center; color:var(--muted); border:1px dashed var(--line); border-radius:10px; }
.command-card { min-height:0; gap:9px; position:relative; transition:.2s transform, .2s box-shadow; }
.command-card:hover { transform:translateY(-1px); box-shadow:var(--shadow); }
.cmd-title-wrap { display:flex; align-items:center; gap:8px; }
.cmd-icon { width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; border-radius:7px; background:linear-gradient(135deg, color-mix(in srgb, var(--accent-1) 20%, transparent), color-mix(in srgb, var(--accent-3) 15%, transparent)); color:var(--accent-1); flex-shrink:0; }
.cmd-icon svg { width:15px; height:15px; }
.cmd-title-text { display:flex; flex-direction:column; gap:2px; }
.cmd-title-text strong { font-size:12.5px; }
.cmd-head-actions { display:flex; gap:3px; }
.cmd-fav-btn { color:var(--muted); }
.cmd-fav-btn.active { color:gold; border-color:gold; }
.cmd-desc { margin:0; font-size:11px; color:var(--muted); line-height:1.5; }
.cmd-params-block { display:grid; gap:4px; }
.cmd-params-label { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
.param-chips { display:flex; flex-wrap:wrap; gap:4px; }
.param-chip { display:inline-flex; align-items:center; gap:4px; padding:3px 6px; border:1px solid var(--line); border-radius:6px; background:var(--panel-strong); font-size:10px; cursor:pointer; transition:.15s; }
.param-chip:hover { border-color:var(--accent-3); }
.param-chip.active { border-color:var(--accent-1); background:color-mix(in srgb, var(--accent-1) 12%, transparent); color:var(--accent-1); }
.param-chip .param-name { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color:var(--accent-3); }
.param-chip.active .param-name { color:var(--accent-1); }
.param-chip input, .param-chip select { height:20px; padding:0 4px; border:1px solid var(--line); border-radius:4px; background:var(--panel); color:var(--text); font-size:10px; width:auto; min-width:36px; }
.cmd-details { color:var(--muted); font-size:11px; }
.cmd-details summary { cursor:pointer; padding:2px 0; }
.cmd-hint { margin:5px 0; color:var(--muted); line-height:1.5; }
.cmd-examples-label { font-size:10px; margin-bottom:3px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
.command-examples { display:flex; flex-wrap:wrap; gap:4px; }
.example-chip { padding:3px 7px; border:1px solid var(--line); border-radius:6px; background:var(--panel-strong); color:var(--accent-3); font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:10px; cursor:pointer; transition:.15s; }
.example-chip:hover { border-color:var(--accent-1); color:var(--accent-1); }
.cmd-terminal { border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#030712; color:#d1fae5; max-height:0; opacity:0; transition:max-height .35s ease, opacity .25s ease, margin .25s ease; margin-top:0; }
.cmd-terminal:not(.hidden) { max-height:420px; opacity:1; margin-top:3px; }
.cmd-terminal.hidden { display:none; }
.cmd-terminal.error { border-color:#ef4444; box-shadow:0 0 0 1px rgba(239,68,68,.2); }
.cmd-terminal.running { border-color:var(--accent-2); }
.cmd-terminal-bar { display:flex; align-items:center; gap:7px; padding:6px 9px; background:rgba(255,255,255,.04); border-bottom:1px solid rgba(255,255,255,.06); font-size:10px; }
.cmd-terminal-bar .dots { display:flex; gap:4px; }
.cmd-terminal-bar .dots span { width:8px; height:8px; border-radius:50%; background:#374151; }
.cmd-terminal-bar .dots span:nth-child(1) { background:#ef4444; }
.cmd-terminal-bar .dots span:nth-child(2) { background:#f59e0b; }
.cmd-terminal-bar .dots span:nth-child(3) { background:#10b981; }
.cmd-term-title { flex:1; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color:#9ca3af; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cmd-term-copy { margin-left:auto; background:transparent; border:none; color:#6b7280; cursor:pointer; font-size:12px; padding:1px 3px; }
.cmd-term-copy:hover { color:#d1fae5; }
.cmd-terminal pre { max-height:340px; overflow:auto; margin:0; padding:9px; white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

/* ── 玻璃终端模态（真实毛玻璃）─────────────────── */
.glass-modal { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; animation:glassFadeIn .25s ease; }
.glass-modal.hidden { display:none; }
@keyframes glassFadeIn { from { opacity:0; } to { opacity:1; } }

/* 背景毛玻璃：多层模糊 + 微妙色调 */
.glass-backdrop {
  position:absolute; inset:0;
  background:
    radial-gradient(ellipse at 20% 30%, rgba(34,211,238,.08), transparent 50%),
    radial-gradient(ellipse at 80% 70%, rgba(168,85,247,.06), transparent 50%),
    rgba(5,10,20,.5);
  backdrop-filter: blur(24px) saturate(180%) contrast(105%);
  -webkit-backdrop-filter: blur(24px) saturate(180%) contrast(105%);
}
/* 噪点层：模拟玻璃颗粒感 */
.glass-backdrop::after {
  content:""; position:absolute; inset:0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E");
  opacity:.5; pointer-events:none; mix-blend-mode:overlay;
}

.glass-terminal-wrap {
  position:relative; width:min(1200px, 94vw); max-width:95vw;
  animation:glassSlideUp .3s cubic-bezier(.2,.8,.2,1);
  /* 外层柔光 */
  filter: drop-shadow(0 0 60px rgba(34,211,238,.08)) drop-shadow(0 20px 60px rgba(0,0,0,.5));
}
@keyframes glassSlideUp { from { opacity:0; transform:translateY(18px) scale(.97); } to { opacity:1; transform:translateY(0) scale(1); } }

/* 终端主体：厚玻璃 */
.glass-terminal {
  position:relative;
  border-radius:16px; overflow:hidden;
  background:
    linear-gradient(135deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,.02) 50%, rgba(255,255,255,.05) 100%),
    rgba(12,16,26,.65);
  backdrop-filter: blur(32px) saturate(200%) contrast(105%);
  -webkit-backdrop-filter: blur(32px) saturate(200%) contrast(105%);
  border:1px solid rgba(255,255,255,.12);
  box-shadow:
    0 0 0 1px rgba(255,255,255,.04) inset,
    0 1px 0 rgba(255,255,255,.15) inset,
    0 -1px 0 rgba(0,0,0,.3) inset,
    0 40px 100px rgba(0,0,0,.6);
  display:flex; flex-direction:column;
  max-height:88vh;
}
/* 玻璃内部噪点 */
.glass-terminal::before {
  content:""; position:absolute; inset:0; pointer-events:none; z-index:1;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  opacity:.6; mix-blend-mode:overlay;
}

.glass-term-bar {
  position:relative; z-index:2;
  display:flex; align-items:center; gap:10px;
  padding:11px 16px;
  background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
  border-bottom:1px solid rgba(255,255,255,.08);
}
.glass-term-dots { display:flex; gap:7px; flex-shrink:0; }
.glass-term-dots span {
  width:12px; height:12px; border-radius:50%;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 1px 2px rgba(0,0,0,.3);
}
.glass-term-dots span:nth-child(1) { background:linear-gradient(180deg, #ff6b6b, #ef4444); cursor:pointer; }
.glass-term-dots span:nth-child(2) { background:linear-gradient(180deg, #fcd34d, #f59e0b); }
.glass-term-dots span:nth-child(3) { background:linear-gradient(180deg, #6ee7b7, #10b981); }
.glass-term-title {
  flex:1; text-align:center;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:12.5px; color:#d1d5db;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  text-shadow:0 1px 2px rgba(0,0,0,.5);
}
.glass-term-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.glass-term-time {
  font-size:11px; color:#9ca3af;
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.glass-term-close, .glass-term-copy-btn {
  width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center;
  border:1px solid rgba(255,255,255,.12); border-radius:7px;
  background:rgba(255,255,255,.04);
  color:#d1d5db; cursor:pointer; font-size:12px;
  transition:.15s;
}
.glass-term-close:hover, .glass-term-copy-btn:hover {
  color:#fff; border-color:rgba(255,255,255,.25); background:rgba(255,255,255,.08);
}
.glass-term-body { position:relative; z-index:2; flex:1; overflow:auto; min-height:300px; max-height:calc(88vh - 110px); }
.glass-term-body pre {
  margin:0; padding:28px 36px;
  font:14px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color:#d1fae5; white-space:pre-wrap; overflow-wrap:anywhere;
  text-shadow:0 0 20px rgba(34,197,94,.08);
}
.glass-term-status {
  position:relative; z-index:2;
  display:flex; align-items:center; justify-content:space-between;
  padding:9px 16px;
  background:rgba(0,0,0,.3);
  border-top:1px solid rgba(255,255,255,.06);
  font-size:11px; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.glass-term-exit.ok { color:#6ee7b7; text-shadow:0 0 10px rgba(110,231,183,.3); }
.glass-term-exit.err { color:#fca5a5; text-shadow:0 0 10px rgba(252,165,165,.3); }
.glass-term-duration { color:#9ca3af; }

/* 主题适配 */
[data-theme="galaxy"] .glass-backdrop {
  background:
    radial-gradient(ellipse at 30% 20%, rgba(168,85,247,.12), transparent 50%),
    radial-gradient(ellipse at 70% 80%, rgba(59,130,246,.1), transparent 50%),
    rgba(8,6,25,.55);
}
[data-theme="galaxy"] .glass-terminal {
  background:
    linear-gradient(135deg, rgba(168,85,247,.1) 0%, rgba(59,130,246,.05) 50%, rgba(236,72,153,.08) 100%),
    rgba(15,10,35,.65);
}
[data-theme="galaxy"] .glass-terminal-wrap {
  filter: drop-shadow(0 0 80px rgba(168,85,247,.12)) drop-shadow(0 20px 60px rgba(0,0,0,.5));
}

[data-theme="sky"] .glass-backdrop {
  background:
    radial-gradient(ellipse at 20% 30%, rgba(147,197,253,.2), transparent 50%),
    radial-gradient(ellipse at 80% 70%, rgba(252,211,77,.15), transparent 50%),
    rgba(200,220,240,.35);
}
[data-theme="sky"] .glass-terminal {
  background:
    linear-gradient(135deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,.65) 50%, rgba(255,255,255,.75) 100%),
    rgba(255,255,255,.7);
  border-color:rgba(255,255,255,.8);
  box-shadow:
    0 0 0 1px rgba(255,255,255,.6) inset,
    0 1px 0 rgba(255,255,255,.9) inset,
    0 40px 80px rgba(30,60,100,.25);
}
[data-theme="sky"] .glass-terminal-wrap {
  filter: drop-shadow(0 0 60px rgba(59,130,246,.15)) drop-shadow(0 20px 60px rgba(0,0,0,.15));
}
[data-theme="sky"] .glass-term-bar { background:linear-gradient(180deg, rgba(255,255,255,.7), rgba(255,255,255,.4)); border-bottom-color:rgba(0,0,0,.08); }
[data-theme="sky"] .glass-term-title { color:#374151; text-shadow:none; }
[data-theme="sky"] .glass-term-body pre { color:#1f2937; text-shadow:none; }
[data-theme="sky"] .glass-term-status { background:rgba(249,250,251,.7); border-top-color:rgba(0,0,0,.06); }
[data-theme="sky"] .glass-term-time, [data-theme="sky"] .glass-term-duration { color:#6b7280; }
[data-theme="sky"] .glass-term-close, [data-theme="sky"] .glass-term-copy-btn { color:#4b5563; border-color:rgba(0,0,0,.1); background:rgba(255,255,255,.5); }
[data-theme="sky"] .glass-term-close:hover, [data-theme="sky"] .glass-term-copy-btn:hover { color:#111827; border-color:rgba(0,0,0,.2); background:rgba(255,255,255,.8); }
</style>
</head>
<body data-theme="cyberpunk">
<div class="shell">
  <header class="topbar">
    <div class="brand"><img class="mark-logo" src="/favicon.svg" alt=""><div><h1>${escapeHtml(labels.title)}</h1><p>${escapeHtml(labels.subtitle)}</p></div></div>
    <div class="controls">
      <button class="lang-btn${lang === 'zh-CN' ? ' active' : ''}" data-lang-target="zh-CN" aria-pressed="${lang === 'zh-CN'}">${escapeHtml(labels.langZh)}</button>
      <button class="lang-btn${lang === 'en' ? ' active' : ''}" data-lang-target="en" aria-pressed="${lang === 'en'}">${escapeHtml(labels.langEn)}</button>
      <button class="theme-btn active" data-theme-target="cyberpunk">${escapeHtml(labels.cyberpunk)}</button>
      <button class="theme-btn" data-theme-target="galaxy">${escapeHtml(labels.galaxy)}</button>
      <button class="theme-btn" data-theme-target="sky">${escapeHtml(labels.sky)}</button>
      <button class="action-btn" id="refresh-btn">${escapeHtml(labels.refresh)}</button>
      <button class="action-btn primary" id="version-check-btn">${escapeHtml(labels.versionCheck)}</button>
      <button class="action-btn" id="version-refresh-btn" title="${escapeHtml(labels.versionRefreshHint)}">${escapeHtml(labels.versionRefresh)}</button>
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
      <section id="skills" class="card full"><div class="section-head"><div><h3>${escapeHtml(labels.navSkills)}</h3><p>${escapeHtml(labels.skillHint)}</p></div><div class="searchbar"><input id="skill-filter" placeholder="${escapeHtml(labels.filterPlaceholder)}"><select id="skill-usage-filter" aria-label="${escapeHtml(labels.usageFilter)}"><option value="all">${escapeHtml(labels.usageAll)}</option><option value="used">${escapeHtml(labels.usageInUse)}</option><option value="unused">${escapeHtml(labels.usageUnused)}</option></select></div></div>${skillPagination(labels, 'top')}<div class="table-wrap"><table class="skill-table"><thead><tr><th>${escapeHtml(labels.name)}</th><th>${escapeHtml(labels.category)}</th><th>${escapeHtml(labels.tools)}</th><th aria-sort="descending"><button class="sort-button active" data-skill-sort="usage">${escapeHtml(labels.usage)}<span class="sort-indicator">↓</span></button></th><th aria-sort="none"><button class="sort-button" data-skill-sort="context">${escapeHtml(labels.context)}<span class="sort-indicator">↕</span></button></th><th>${escapeHtml(labels.source)}</th><th>${escapeHtml(labels.versionState)}</th></tr></thead><tbody id="skill-rows"></tbody></table></div>${skillPagination(labels, 'bottom')}</section>
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
      <section id="commands" class="card full">
        <div class="section-head">
          <div><h3>${escapeHtml(labels.navCommands)}</h3><p>${escapeHtml(labels.commandHint)}</p></div>
          <div class="cmd-toolbar">
            <input class="cmd-search" id="cmd-search" placeholder="${escapeHtml(labels.cmdSearchPlaceholder)}">
            <div class="cmd-filter-tabs" id="cmd-filter-tabs"></div>
          </div>
        </div>
        <div class="cmd-workflows" id="cmd-workflows"></div>
        <div class="command-groups" id="command-list"></div>
      </section>
    </main>
  </div>
</div>
<div class="glass-modal hidden" id="glass-modal" role="dialog" aria-modal="true">
  <div class="glass-backdrop" data-glass-close></div>
  <div class="glass-terminal-wrap">
    <div class="glass-terminal">
      <div class="glass-term-bar">
        <div class="glass-term-dots"><span></span><span></span><span></span></div>
        <div class="glass-term-title"></div>
        <div class="glass-term-actions">
          <span class="glass-term-time"></span>
          <button class="icon-button glass-term-copy-btn" title="${escapeHtml(labels.cmdCopyOutput || '')}">⧉</button>
          <button class="icon-button glass-term-close" data-glass-close aria-label="close">✕</button>
        </div>
      </div>
      <div class="glass-term-body"><pre></pre></div>
      <div class="glass-term-status">
        <span class="glass-term-exit"></span>
        <span class="glass-term-duration"></span>
      </div>
    </div>
  </div>
</div>
<div class="governance-modal hidden" id="governance-modal" role="dialog" aria-modal="true" aria-labelledby="governance-title">
  <div class="governance-backdrop" data-governance-close></div>
  <section class="governance-dialog" tabindex="-1">
    <div class="governance-head"><div><h3 id="governance-title"></h3><p id="governance-subtitle"></p></div><button class="governance-close" data-governance-close aria-label="${escapeHtml(labels.close)}">✕</button></div>
    <div id="governance-body"></div>
  </section>
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
    subtitle: en ? 'Local AIDE skill governance cockpit with explicit confirmations' : '带显式确认的本地 AIDE skill 治理驾驶舱',
    eyebrow: en ? 'VibeCoding control plane' : 'VibeCoding 控制平面',
    heroTitle: en ? 'Skill lifecycle cockpit.' : 'skill 生命周期治理驾驶舱。',
    heroText: en ? 'Inventory, sources, freshness checks, lifecycle baselines, risks, usage, and the knowledge graph are gathered into one local page.' : '清单、来源、版本新鲜度、生命周期基线、风险、使用频率和知识图谱，集中到一个本地页面里。',
    cyberpunk: en ? 'Cyberpunk' : '赛博朋克',
    galaxy: en ? 'Galaxy' : '宇宙星系',
    sky: en ? 'Sky' : '蓝天白云',
    langZh: en ? 'Chinese' : '中文',
    langEn: 'English',
    refresh: en ? 'Refresh Scan' : '刷新扫描',
    versionCheck: en ? 'Check Versions' : '检查版本',
    versionRefresh: en ? 'Force Check' : '强制检查',
    versionRefreshHint: en ? 'Ignore the 24-hour cache and query recorded sources now.' : '忽略 24 小时缓存，立即查询已记录来源。',
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
    refreshingText: en ? 'Running the same local inventory path as skm scan.' : '正在运行与 skm scan 相同的本地清单扫描路径。',
    localOnly: en ? 'local only · 127.0.0.1 · writes require explicit confirmation' : '仅本机 · 127.0.0.1 · 写入操作需要显式确认',
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
    sourceMethod: en ? 'Recording method' : '记录方式',
    sourceVerifiedAt: en ? 'Verified' : '验证时间',
    sourceConfidence: en ? 'Confidence' : '置信度',
    sourceEdit: en ? 'Complete source' : '补全来源',
    sourceTracked: en ? 'tracked' : '已记录',
    sourcePartial: en ? 'partial' : '部分记录',
    sourceMissing: en ? 'missing' : '缺失',
    sourceDialogTitle: en ? 'Complete upstream source' : '补全上游来源',
    sourceDialogText: en ? 'Choose the installations this source applies to. A URL is saved only after you confirm.' : '选择该来源适用的安装实例。只有你确认后才会保存 URL。',
    sourceTargets: en ? 'Installations needing a source' : '需要补来源的安装实例',
    sourceManualTitle: en ? 'Enter a source URL' : '填写来源 URL',
    sourceManualHint: en ? 'Use a GitHub/Gitee skill directory, SKILL.md, git, file, or HTTPS URL.' : '可填写 GitHub/Gitee skill 目录、SKILL.md、git、file 或 HTTPS URL。',
    sourceUrlLabel: en ? 'Source URL' : '来源 URL',
    sourceUrlPlaceholder: en ? 'https://github.com/org/repo/tree/main/skill' : 'https://github.com/org/repo/tree/main/skill',
    sourceSave: en ? 'Save URL' : '保存 URL',
    sourceSearchTitle: en ? 'Search public sources' : '搜索公开来源',
    sourceSearchHint: en ? 'With your permission, only the skill name and static GitHub qualifiers are sent to GitHub. Results are suggestions, never auto-saved.' : '经你授权后，仅会把 skill 名称和固定 GitHub 搜索限定词发送到 GitHub；结果只作候选，不会自动保存。',
    sourceAllowSearch: en ? 'Allow GitHub search' : '允许搜索来源',
    sourceCandidatesTitle: en ? 'Verified candidates' : '已验证候选来源',
    sourceCandidateSave: en ? 'Save selected candidate' : '保存选中的候选',
    sourceSearchLoading: en ? 'Searching GitHub…' : '正在搜索 GitHub…',
    sourceSaveLoading: en ? 'Saving…' : '正在保存…',
    sourceNoCandidates: en ? 'No verified candidates were found.' : '没有找到可验证的候选来源。',
    sourceChooseCandidate: en ? 'Select one candidate first.' : '请先选择一个候选来源。',
    sourceSaved: en ? 'Source saved successfully.' : '来源已保存。',
    sourceSearchFailed: en ? 'Search failed. Nothing was saved.' : '搜索失败，未保存任何来源。',
    sourceTargetRequired: en ? 'Select at least one installation.' : '至少选择一个安装实例。',
    close: en ? 'Close' : '关闭',
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
    cmdSearchPlaceholder: en ? 'Search commands...' : '搜索命令...',
    cmdGroupDiagnosis: en ? 'Overview & Diagnosis' : '总览与诊断',
    cmdGroupExplore: en ? 'Explore & Search' : '探查与检索',
    cmdGroupAudit: en ? 'Usage & Audit' : '使用与审计',
    cmdGroupLifecycle: en ? 'Lifecycle Governance' : '生命周期治理',
    cmdAll: en ? 'All' : '全部',
    cmdFavorites: en ? 'Favorites' : '收藏',
    cmdWorkflows: en ? 'Quick workflows' : '快速工作流',
    cmdWorkflowQuickCheck: en ? 'Quick check' : '快速体检',
    cmdWorkflowDeepAudit: en ? 'Deep audit' : '深入审计',
    cmdWorkflowCleanup: en ? 'Cleanup plan' : '清理优化',
    cmdExamples: en ? 'Examples' : '常见用法',
    cmdClickToFill: en ? 'Click to fill' : '点击填入',
    cmdCopyOutput: en ? 'Copy output' : '复制输出',
    cmdFavorite: en ? 'Favorite' : '收藏',
    cmdUnfavorite: en ? 'Unfavorite' : '取消收藏',
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
    versionState: en ? 'Version' : '版本状态',
    versionLatest: en ? 'latest' : '最新',
    versionOutdated: en ? 'outdated' : '过期',
    versionDiverged: en ? 'diverged' : '分叉',
    versionAhead: en ? 'ahead' : '领先',
    versionUnchecked: en ? 'unchecked' : '待检查',
    versionUnknown: en ? 'unknown' : '无法判断',
    versionUntracked: en ? 'untracked' : '未记录',
    versionChecked: en ? 'checked' : '已检查',
    versionCached: en ? 'cached' : '缓存',
    versionUpdatePreview: en ? 'Preview update' : '预览升级',
    versionNoPreview: en ? 'No update preview available' : '暂无升级预览',
    versionChecking: en ? 'Checking recorded sources…' : '正在检查已记录来源…',
    versionCheckDone: en ? 'Version check complete.' : '版本检查完成。',
    versionCheckIncomplete: en ? 'Some skills could not be checked; review missing or unknown sources.' : '部分 skill 无法完成检查，请处理缺失或无法判断的来源。',
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
