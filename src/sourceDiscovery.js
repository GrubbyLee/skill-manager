import { parseFrontmatter } from './frontmatter.js';

const FETCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 8;

export async function discoverSkillSources(skillName, { provider = 'github', fetchImpl = globalThis.fetch, maxResults = MAX_RESULTS, githubToken = process.env.GITHUB_TOKEN } = {}) {
  const name = String(skillName || '').trim();
  if (!name) throw new Error('skill name is required');
  if (provider !== 'github') throw new Error(`unsupported source discovery provider: ${provider}`);
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  const limit = Math.min(MAX_RESULTS, Math.max(1, maxResults));
  const query = githubToken ? `${name} filename:SKILL.md` : repositorySearchQuery(name);
  const searchResult = githubToken
    ? await searchGithubCode(query, limit, fetchImpl, githubToken)
    : await searchGithubRepositories(query, name, limit, fetchImpl);
  const items = searchResult.items;
  const inspectedResults = await Promise.allSettled(items.map((item) => inspectGithubCandidate(item, name, fetchImpl, githubToken)));
  const candidates = inspectedResults
    .filter((result) => result.status === 'fulfilled' && result.value && result.value.score >= 35)
    .map((result) => result.value);
  if (!candidates.length) {
    const error = searchResult.errors[0] || inspectedResults.find((result) => result.status === 'rejected')?.reason;
    if (error) throw error;
  }
  candidates.sort((a, b) => b.score - a.score || a.repository.localeCompare(b.repository) || a.path.localeCompare(b.path));
  return { provider, query, searchedAt: new Date().toISOString(), candidates: candidates.slice(0, limit) };
}

async function searchGithubCode(query, limit, fetchImpl, githubToken) {
  const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`;
  const search = await fetchJson(searchUrl, fetchImpl, { accept: 'application/vnd.github+json', githubToken });
  return { items: Array.isArray(search.items) ? search.items : [], errors: [] };
}

async function searchGithubRepositories(query, requestedName, limit, fetchImpl) {
  const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10`;
  const search = await fetchJson(searchUrl, fetchImpl, { accept: 'application/vnd.github+json' });
  const candidateFileLimit = Math.min(24, limit * 3);
  const groups = await Promise.all((Array.isArray(search.items) ? search.items : []).map(async (repository) => {
    if (!repository.full_name || !repository.default_branch) return { items: [], error: null };
    const [owner, repo] = repository.full_name.split('/');
    if (!owner || !repo) return { items: [], error: null };
    const treeUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`;
    let tree;
    try {
      tree = await fetchJson(treeUrl, fetchImpl, { accept: 'application/vnd.github+json' });
    } catch (error) {
      return { items: [], error };
    }
    const items = (Array.isArray(tree.tree) ? tree.tree : [])
      .filter((entry) => entry.type === 'blob' && isSkillMdPath(entry.path))
      .map((entry) => ({
        path: entry.path,
        download_url: `https://raw.githubusercontent.com/${repository.full_name}/${encodePath(repository.default_branch)}/${encodePath(entry.path)}`,
        repository,
        roughScore: roughPathScore(entry.path, requestedName, repository.name),
      }));
    return { items, error: null };
  }));
  const items = groups.flatMap((group) => group.items);
  return {
    items: items.sort((a, b) => b.roughScore - a.roughScore).slice(0, candidateFileLimit),
    errors: groups.map((group) => group.error).filter(Boolean),
  };
}

function repositorySearchQuery(name) {
  const literal = String(name || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return `"${literal}" SKILL.md in:readme`;
}

async function inspectGithubCandidate(item, requestedName, fetchImpl, githubToken) {
  const repository = item.repository || {};
  const fullName = String(repository.full_name || '').trim();
  const repositoryUrl = String(repository.html_url || (fullName ? `https://github.com/${fullName}` : '')).replace(/\/$/, '');
  const path = String(item.path || '').replaceAll('\\', '/');
  if (!fullName || !repositoryUrl || !isSkillMdPath(path)) return null;
  const ref = String(repository.default_branch || 'main');
  const subdir = dirname(path);
  const source = `${repositoryUrl}/tree/${encodePath(ref)}${subdir ? `/${encodePath(subdir)}` : ''}`;
  const rawUrl = item.download_url || rawUrlFromGithubItem(item, ref);
  const text = await fetchText(rawUrl, fetchImpl, { accept: 'application/vnd.github.raw+json', githubToken });
  const { data } = parseFrontmatter(text);
  const score = scoreCandidate(requestedName, data, repository.name || fullName.split('/').pop(), subdir);
  return {
    source,
    repository: fullName,
    repositoryUrl,
    path,
    subdir: subdir || null,
    ref,
    name: String(data.name || basename(repository.name || fullName)),
    description: String(data.description || '').trim(),
    version: String(data.version || '').trim() || null,
    score,
    confidence: Number(Math.min(0.99, Math.max(0.05, score / 100)).toFixed(2)),
    verified: true,
    evidence: {
      matchedFrontmatterName: Boolean(data.name && normalize(data.name) === normalize(requestedName)),
      matchedDirectoryName: Boolean(subdir && normalize(basename(subdir)) === normalize(requestedName)),
      hasSkillMd: true,
    },
  };
}

function isSkillMdPath(value) {
  const path = String(value || '').toLowerCase();
  return path === 'skill.md' || path.endsWith('/skill.md');
}

function roughPathScore(path, requestedName, repositoryName) {
  const subdir = dirname(path);
  const requested = normalize(requestedName);
  const directory = normalize(basename(subdir));
  const repository = normalize(repositoryName);
  let score = 0;
  if (directory === requested) score += 30;
  else if (directory.includes(requested) || requested.includes(directory)) score += 10;
  if (repository === requested) score += 20;
  else if (repository.includes(requested) || requested.includes(repository)) score += 8;
  return score;
}

function scoreCandidate(requestedName, frontmatter, repositoryName, subdir) {
  const requested = normalize(requestedName);
  const frontmatterName = normalize(frontmatter.name);
  const directoryName = normalize(basename(subdir || ''));
  const repository = normalize(repositoryName);
  let score = 10;
  if (frontmatterName && frontmatterName === requested) score += 60;
  else if (frontmatterName && (frontmatterName.includes(requested) || requested.includes(frontmatterName))) score += 25;
  if (directoryName === requested) score += 25;
  else if (directoryName.includes(requested) || requested.includes(directoryName)) score += 10;
  if (repository === requested) score += 15;
  else if (repository.includes(requested) || requested.includes(repository)) score += 8;
  return Math.min(100, score);
}

async function fetchJson(url, fetchImpl, options = {}) {
  const response = await request(url, fetchImpl, options);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON response from ${new URL(url).hostname}`);
  }
}

async function fetchText(url, fetchImpl, options = {}) {
  const response = await request(url, fetchImpl, options);
  return response.text();
}

async function request(url, fetchImpl, { accept, githubToken } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {
      accept: accept || 'application/vnd.github+json',
      'user-agent': 'aide-skill-manager',
      'x-github-api-version': '2022-11-28',
    };
    if (githubToken && new URL(url).hostname === 'api.github.com') headers.authorization = `Bearer ${githubToken}`;
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers,
    });
    if (!response.ok) throw await githubApiError(response);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function githubApiError(response) {
  let detail = '';
  try {
    const body = JSON.parse(await response.text());
    detail = String(body.message || '').trim();
  } catch {
    detail = '';
  }
  if (response.status === 401) return new Error('GitHub code search requires authentication; set GITHUB_TOKEN and retry');
  if (response.status === 403) return new Error(`GitHub API rate limit or access denied${detail ? `: ${detail}` : ''}; set GITHUB_TOKEN or retry later`);
  return new Error(`GitHub API HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
}

function rawUrlFromGithubItem(item, ref) {
  const fullName = item.repository?.full_name;
  if (!fullName || !item.path) return '';
  return `https://raw.githubusercontent.com/${fullName}/${encodePath(ref)}/${encodePath(item.path)}`;
}

function encodePath(value) {
  return String(value || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

function dirname(value) {
  const index = String(value).lastIndexOf('/');
  return index < 0 ? '' : String(value).slice(0, index);
}

function basename(value) {
  return String(value || '').split('/').filter(Boolean).pop() || '';
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}
