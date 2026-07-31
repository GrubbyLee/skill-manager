import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mergeByDirName } from '../catalog.js';
import { ensureCatalog } from './scan.js';
import { UPDATE_CACHE_PATH } from '../paths.js';
import { loadJsonFile, saveJsonFile, paint } from '../utils.js';
import { renderTable, termWidth } from '../table.js';
import { tr } from '../i18n.js';
import { applySourcesToSkills } from '../sources.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const VISIBLE_ROWS = 40;

// skm outdated：默认只看本地元数据；--online 才访问上游，且只做检查不更新。
export async function runOutdated({ cwd, json = false, online = false, refresh = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(applySourcesToSkills(catalog.skills || []));
  const rows = await collectOutdatedRows(merged, { online, refresh, lang });

  if (json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      online,
      summary: summarize(rows),
      items: rows,
    }, null, 2));
    return;
  }

  console.log(paint.green(tr(lang, 'outdated.done')) + '\n');
  if (!online) console.log(tr(lang, 'outdated.offlineNote') + '\n');
  const visibleRows = rows.slice(0, VISIBLE_ROWS);
  console.log(renderTable(
    [
      { title: tr(lang, 'outdated.col.name'), width: 30 },
      { title: tr(lang, 'outdated.col.current'), width: 14 },
      { title: tr(lang, 'outdated.col.source'), width: 16 },
      { title: tr(lang, 'outdated.col.status'), width: 12 },
      { title: tr(lang, 'outdated.col.suggestion'), width: 0 },
    ],
    visibleRows.map((row) => [
      row.dirName,
      row.current || '—',
      sourceLabel(row, lang),
      statusLabel(row.status, lang),
      row.suggestion,
    ]),
    termWidth(),
  ));
  if (rows.length > visibleRows.length) console.log(tr(lang, 'outdated.more', { count: rows.length - visibleRows.length }));

  const summary = summarize(rows);
  console.log('\n' + tr(lang, 'outdated.summary', summary));
  if (!online) console.log(tr(lang, 'outdated.onlineHint'));
}

export async function collectOutdatedRows(skills, { online = false, refresh = false, lang = 'zh-CN', fetchImpl = globalThis.fetch, spawnImpl = spawnSync, cache = null } = {}) {
  const cacheState = cache || loadUpdateCache();
  const rows = [];
  for (const skill of skills) {
    const row = buildLocalRow(skill, lang);
    if (online && row.check?.kind) {
      const remote = await checkRemote(row.check, { cache: cacheState, refresh, fetchImpl, spawnImpl });
      applyRemoteResult(row, remote, lang);
    }
    rows.push(stripInternal(row));
  }
  if (online && !cache) saveUpdateCache(cacheState);
  return rows.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || sourceOrder(a) - sourceOrder(b) || a.dirName.localeCompare(b.dirName));
}

function buildLocalRow(skill, lang) {
  const entries = skill.entries || [skill];
  const selected = chooseUpstreamEntry(entries);
  const upstream = selected.upstream || {};
  const current = upstream.version || short(upstream.git?.head) || short(selected.skillMdHash) || null;
  const check = buildCheck(upstream, selected);
  let status = 'untracked';
  let suggestion = tr(lang, 'outdated.suggestion.untracked');
  if (check.kind) {
    status = 'unchecked';
    suggestion = tr(lang, 'outdated.suggestion.checkOnline');
  } else if (upstream.source || upstream.repository || upstream.homepage || upstream.git?.remote) {
    status = 'unknown';
    suggestion = tr(lang, 'outdated.suggestion.uncheckableSource');
  } else if (upstream.version) {
    status = 'unknown';
    suggestion = tr(lang, 'outdated.suggestion.versionOnly');
  }
  return {
    dirName: skill.dirName,
    name: skill.name,
    tools: skill.tools || entries.map((e) => e.tool),
    category: skill.category,
    current,
    currentVersion: upstream.version || null,
    currentCommit: upstream.git?.head || null,
    sourceUrl: upstream.source || upstream.repository || upstream.homepage || upstream.git?.remote || null,
    git: upstream.git || null,
    status,
    suggestion,
    check,
  };
}

function chooseUpstreamEntry(entries) {
  const scored = entries.map((entry, index) => ({ entry, index, score: upstreamScore(entry.upstream || {}) }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.entry || {};
}

function upstreamScore(upstream) {
  if (upstream.git?.remote && upstream.git?.head) return 50;
  if (rawSkillUrls(upstream.source).length) return 45;
  if (rawSkillUrls(upstream.repository).length) return 40;
  if (rawSkillUrls(upstream.homepage).length) return 35;
  if (upstream.source || upstream.repository || upstream.homepage) return 20;
  if (upstream.version) return 10;
  return 0;
}

function buildCheck(upstream, skill) {
  if (upstream.git?.remote && upstream.git?.head) {
    return {
      kind: 'git',
      remote: upstream.git.remote,
      branch: upstream.git.branch || null,
      upstreamRef: upstream.git.upstreamRef || null,
      localHead: upstream.git.head,
    };
  }
  const urls = firstNonEmpty([
    rawSkillUrls(upstream.source),
    rawSkillUrls(upstream.repository),
    rawSkillUrls(upstream.homepage),
  ]);
  if (urls.length) {
    return {
      kind: 'skill-md',
      url: urls[0],
      urls,
      localVersion: upstream.version || null,
      localHash: skill.skillMdHash || null,
    };
  }
  return {};
}

async function checkRemote(check, { cache, refresh, fetchImpl, spawnImpl }) {
  const key = cacheKey(check);
  if (!refresh) {
    const cached = cache.items[key];
    if (cached && Date.now() - Date.parse(cached.checkedAt || 0) < CACHE_TTL_MS) return { ...cached, cached: true };
  }

  let result;
  if (check.kind === 'git') result = checkGitRemote(check, spawnImpl);
  else if (check.kind === 'skill-md') result = await checkRemoteSkillMd(check, fetchImpl);
  else result = { status: 'unknown', reason: 'unsupported' };

  cache.items[key] = { ...result, checkedAt: new Date().toISOString() };
  return cache.items[key];
}

function checkGitRemote(check, spawnImpl) {
  const branch = branchFromUpstreamRef(check.upstreamRef) || check.branch;
  const refs = branch && branch !== 'HEAD' ? [`refs/heads/${branch}`] : ['HEAD'];
  for (const ref of refs) {
    const r = spawnImpl('git', ['ls-remote', check.remote, ref], { encoding: 'utf8', timeout: FETCH_TIMEOUT_MS, windowsHide: true });
    if (r.status !== 0) continue;
    const head = String(r.stdout || '').trim().split(/\s+/)[0];
    if (/^[0-9a-f]{40}$/i.test(head)) {
      return {
        status: head === check.localHead ? 'latest' : 'outdated',
        remoteCommit: head,
        reason: 'git',
      };
    }
  }
  return { status: 'unknown', reason: 'git-remote-unavailable' };
}

async function checkRemoteSkillMd(check, fetchImpl) {
  if (typeof fetchImpl !== 'function') return { status: 'unknown', reason: 'fetch-unavailable' };
  const urls = check.urls?.length ? check.urls : [check.url];
  let lastReason = 'no-url';
  for (const url of urls) {
    const result = await checkOneRemoteSkillMd({ ...check, url }, fetchImpl);
    if (result.status !== 'unknown') return result;
    lastReason = result.reason || lastReason;
  }
  return { status: 'unknown', reason: lastReason };
}

async function checkOneRemoteSkillMd(check, fetchImpl) {
  try {
    const text = await fetchText(check.url, fetchImpl);
    const remoteHash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
    const remoteVersion = parseFrontmatterValue(text, 'version');
    if (check.localVersion && remoteVersion) {
      return {
        status: check.localVersion === remoteVersion ? 'latest' : 'outdated',
        remoteVersion,
        remoteHash,
        reason: 'version',
      };
    }
    if (check.localHash) {
      return {
        status: check.localHash === remoteHash ? 'latest' : 'outdated',
        remoteVersion,
        remoteHash,
        reason: 'hash',
      };
    }
    return { status: 'unknown', remoteVersion, remoteHash, reason: 'no-local-baseline' };
  } catch (e) {
    return { status: 'unknown', reason: e.message };
  }
}

async function fetchText(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'aide-skill-manager' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function applyRemoteResult(row, remote, lang) {
  row.remoteVersion = remote.remoteVersion || null;
  row.remoteCommit = remote.remoteCommit || null;
  row.remoteHash = remote.remoteHash || null;
  row.checkedAt = remote.checkedAt || null;
  row.cached = Boolean(remote.cached);
  if (remote.status === 'latest') {
    row.status = 'latest';
    row.suggestion = tr(lang, 'outdated.suggestion.latest');
  } else if (remote.status === 'outdated') {
    row.status = 'outdated';
    row.suggestion = remote.remoteVersion
      ? tr(lang, 'outdated.suggestion.updateVersion', { version: remote.remoteVersion })
      : tr(lang, 'outdated.suggestion.reviewDiff');
  } else {
    row.status = 'unknown';
    row.suggestion = tr(lang, 'outdated.suggestion.unknown');
  }
}

function stripInternal(row) {
  const { check, ...rest } = row;
  return rest;
}

function loadUpdateCache() {
  const c = loadJsonFile(UPDATE_CACHE_PATH);
  if (c?.version === 1 && c.items && typeof c.items === 'object') return c;
  return { version: 1, items: {} };
}

function saveUpdateCache(cache) {
  saveJsonFile(UPDATE_CACHE_PATH, cache, { pretty: true });
}

function cacheKey(check) {
  return crypto.createHash('sha256').update(JSON.stringify(check)).digest('hex').slice(0, 24);
}

function parseFrontmatterValue(text, key) {
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => l.match(new RegExp(`^${key}:\\s*`, 'i')));
  if (!line) return null;
  return line.replace(new RegExp(`^${key}:\\s*`, 'i'), '').trim().replace(/^['"]|['"]$/g, '') || null;
}

function firstNonEmpty(groups) {
  return groups.find((group) => group.length) || [];
}

function rawSkillUrls(url) {
  if (!url || !/^https?:\/\//i.test(url)) return [];
  let u;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.hostname === 'github.com' && parts.length >= 2) {
    const [owner, repoRaw, kind, branch, ...rest] = parts;
    const repo = repoRaw.replace(/\.git$/, '');
    if ((kind === 'tree' || kind === 'blob') && branch) {
      const filePath = rest.join('/').endsWith('SKILL.md') ? rest.join('/') : [...rest, 'SKILL.md'].join('/');
      return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`];
    }
    if (!kind) return ['main', 'master'].map((b) => `https://raw.githubusercontent.com/${owner}/${repo}/${b}/SKILL.md`);
  }
  if (u.hostname === 'gitee.com' && parts.length >= 2) {
    const [owner, repoRaw, kind, branch, ...rest] = parts;
    const repo = repoRaw.replace(/\.git$/, '');
    if ((kind === 'tree' || kind === 'blob') && branch) {
      const filePath = rest.join('/').endsWith('SKILL.md') ? rest.join('/') : [...rest, 'SKILL.md'].join('/');
      return [`https://gitee.com/${owner}/${repo}/raw/${branch}/${filePath}`];
    }
    if (!kind) return ['master', 'main'].map((b) => `https://gitee.com/${owner}/${repo}/raw/${b}/SKILL.md`);
  }
  if (u.pathname.endsWith('/SKILL.md')) return [url];
  return [];
}

function branchFromUpstreamRef(ref) {
  const text = String(ref || '');
  if (!text || text === 'HEAD') return null;
  const slash = text.indexOf('/');
  return slash >= 0 ? text.slice(slash + 1) : text;
}

function sourceLabel(row, lang) {
  if (row.git?.remote) return 'git';
  if (row.sourceUrl) return /^https?:\/\//.test(row.sourceUrl) ? 'url' : tr(lang, 'common.none');
  return tr(lang, 'common.none');
}

function statusLabel(status, lang) {
  const labels = {
    latest: tr(lang, 'outdated.status.latest'),
    outdated: tr(lang, 'outdated.status.outdated'),
    unchecked: tr(lang, 'outdated.status.unchecked'),
    unknown: tr(lang, 'outdated.status.unknown'),
    untracked: tr(lang, 'outdated.status.untracked'),
  };
  if (status === 'latest') return paint.green(labels.latest);
  if (status === 'outdated') return paint.yellow(labels.outdated);
  if (status === 'untracked') return paint.gray(labels.untracked);
  return labels[status] || status;
}

function summarize(rows) {
  return {
    total: rows.length,
    latest: rows.filter((r) => r.status === 'latest').length,
    outdated: rows.filter((r) => r.status === 'outdated').length,
    unchecked: rows.filter((r) => r.status === 'unchecked').length,
    unknown: rows.filter((r) => r.status === 'unknown').length,
    untracked: rows.filter((r) => r.status === 'untracked').length,
  };
}

function statusOrder(status) {
  return { outdated: 0, unchecked: 1, unknown: 2, untracked: 3, latest: 4 }[status] ?? 9;
}

function sourceOrder(row) {
  if (row.git?.remote || row.sourceUrl) return 0;
  if (row.currentVersion) return 1;
  return 2;
}

function short(value) {
  return value ? String(value).slice(0, 12) : null;
}
